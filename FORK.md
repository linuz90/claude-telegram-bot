# Fork notes

Fork of [linuz90/claude-telegram-bot](https://github.com/linuz90/claude-telegram-bot).
Runs the same bot on **OpenRouter instead of a claude.ai subscription**, with
real tool restrictions and a Docker deployment.

Upstream docs still apply; this file only covers what differs.

## Why

- A claude.ai subscription may not be used for production workloads, and its
  OAuth session needs re-authenticating periodically. A static API key does not.
- Upstream hardcodes the model and checks tool safety *after* the tool has
  already been dispatched.

## What changed

| Area | Upstream | Here |
|---|---|---|
| Auth | claude.ai login or `ANTHROPIC_API_KEY` | OpenRouter key via `ANTHROPIC_AUTH_TOKEN` |
| Model | hardcoded `claude-sonnet-4-5` | `BOT_MODEL` env var |
| Tool safety | post-hoc check in the stream loop | deny rules + `PreToolUse` hook |
| State | `/tmp` | `STATE_DIR`, mountable |
| Deploy | macOS LaunchAgent | Docker (LaunchAgent left intact) |

New files: `src/provider.ts`, `src/permissions.ts`, `Dockerfile`,
`docker-compose.yml`. Everything else is a small edit, to keep upstream merges clean.

## Configuration

Add to `.env`:

```bash
# Provider. The Agent SDK guide puts the key in ANTHROPIC_AUTH_TOKEN, not
# ANTHROPIC_API_KEY - provider.ts sets ANTHROPIC_API_KEY="" for you.
OPENROUTER_API_KEY=sk-or-v1-...
ANTHROPIC_BASE_URL=https://openrouter.ai/api

# Any OpenRouter slug; behind a custom base URL model strings are not validated.
#   anthropic/claude-sonnet-5     <- recommended baseline
#   moonshotai/kimi-k2-thinking
#   z-ai/glm-4.6
BOT_MODEL=anthropic/claude-sonnet-5
BOT_SUBAGENT_MODEL=

# Leave false. Set true only if a model returns a 400 naming the "thinking"
# field or another unrecognised request field.
BOT_DISABLE_ADAPTIVE_THINKING=false
BOT_DISABLE_EXPERIMENTAL_BETAS=false

# /tmp locally, /data in Docker.
STATE_DIR=/tmp
```

### Why the auth token and not the API key

Both work over the wire, but `ANTHROPIC_AUTH_TOKEN` takes precedence
immediately, while `ANTHROPIC_API_KEY` triggers a one-time interactive approval
prompt that a headless bot can never answer. `ANTHROPIC_API_KEY` is set to an
empty string rather than left unset: unset makes Claude Code fall back to
authenticating against Anthropic's own servers.

### Non-Claude models

OpenRouter's "Anthropic skin" passes thinking blocks and native tool use
through, so Kimi, GLM and GPT slugs are worth trying. OpenRouter still warns
that Claude Code is optimised for Anthropic models. If a model misbehaves, the
order to try is: a 400 mentioning `thinking` → set
`BOT_DISABLE_ADAPTIVE_THINKING=true`; a 400 naming an unknown field → also set
`BOT_DISABLE_EXPERIMENTAL_BETAS=true`; broken tool calls → the model is not
usable here.

Change one thing at a time and start from a Claude slug, so a provider problem
is never confused with a model-compatibility problem.

## Tool restrictions

The bot stays in `bypassPermissions` so it never blocks waiting for a human.
Two things still bite in that mode, and both are used:

1. **Deny rules** (`DENY_RULES` in `src/permissions.ts`) — static command
   patterns, blocked in every permission mode.
2. **`PreToolUse` hook** — runs before every other permission step. Reuses
   `checkCommandSafety()` and `isPathAllowed()` from `src/security.ts`, and
   blocks credential files (`.env`, `.ssh`, `*.pem`, …) outright.

A `canUseTool` callback would be useless here: under `bypassPermissions` it is
never reached.

To loosen or tighten, edit `DENY_RULES` and `SECRET_PATTERNS`. Deny rules are
prefix globs, so `Bash(rm -rf /*)` catches the direct form but not
`foo && rm -rf /` — the hook is what covers the rest.

## Deploy

```bash
docker compose up -d --build
docker compose logs -f
```

`bot-state` (mounted at `/data`) holds the session file, audit log and Telegram
downloads. Without it `/resume` forgets everything on redeploy. `./workspace` is
the agent's working directory; the container runs as the non-root `bun` user, so
that directory must be writable by uid 1000.

## Tracking upstream

```bash
git fetch upstream
git merge upstream/main
```

## Troubleshooting

- **401 from the provider** — the key is in the wrong variable. It belongs in
  `ANTHROPIC_AUTH_TOKEN` (sent as `Authorization: Bearer`).
- **Model-not-found for an OpenRouter slug, locally** — a cached Anthropic login
  can conflict. Run `/logout` in Claude Code; on macOS also check
  `security find-generic-password -s "Claude Code-credentials"`. Not an issue in
  Docker, which has no cached login.
- **PDFs or archives fail** — `pdftotext` (poppler-utils) or `unzip` is missing.
  Both are in the image; locally, `brew install poppler`.
