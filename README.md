# Claude Telegram Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.0+-black.svg)](https://bun.sh/)

Run a Claude Code agent from Telegram. Send text, voice, photos, documents,
audio and video; see the reply and the tool calls stream back in real time.

Fork of [linuz90/claude-telegram-bot](https://github.com/linuz90/claude-telegram-bot),
with three changes: it runs on **any Anthropic-compatible provider** (OpenRouter
by default) instead of a claude.ai subscription, the model is configurable, and it
deploys as a Docker container instead of a macOS LaunchAgent.

This is a template. It ships no agent instructions of its own: put a `CLAUDE.md`
and skills in `agent/`, and that becomes the agent. The container is the only
supported way to run it.

## Features

- **Text** — questions, instructions, conversation
- **Voice** — transcribed via OpenAI, then handled as text
- **Photos** — single images or albums (buffered for 1s to group them)
- **Documents** — PDFs (via `pdftotext`), text files, ZIP/TAR archives
- **Audio** — mp3, m4a, ogg, wav and friends, transcribed via OpenAI
- **Video** — video messages and video notes
- **One continuing conversation** — the last session is picked up automatically
  on startup, so a redeploy does not reset the thread. Claude Code compacts it
  when the context fills. `/resume` reaches older sessions, `/new` starts over
- **Message queuing** — send more while Claude works and they queue up. Prefix
  with `!` or use `/stop` to interrupt instead
- **Extended thinking** — triggered by keywords like "think" (configurable via
  `THINKING_KEYWORDS`); the reasoning streams to the chat
- **Interactive buttons** — the `ask_user` MCP server turns options into tappable
  inline buttons
- **File delivery** — the `send_file` MCP server sends files back to the chat

## Quick start

```bash
cp .env.example .env
# Fill in TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS and OPENROUTER_API_KEY

cp deployment/docker-compose.example.yml deployment/docker-compose.yml

docker compose -f deployment/docker-compose.yml up -d --build
docker compose -f deployment/docker-compose.yml logs -f
```

Prerequisites: Docker, a bot token from [@BotFather](https://t.me/BotFather),
and a provider key. Everything else, `pdftotext` and `unzip` included, is in the
image.

On a Linux host, read [Permissions on the deploy
host](#permissions-on-the-deploy-host) first — the container writes as a fixed
uid and will silently fail to write anything otherwise.

## Configuration

### 1. Create the bot

Send `/newbot` to [@BotFather](https://t.me/BotFather) and copy the token. Then
send `/setcommands` and paste:

```
start - Status en je gebruikers-ID tonen
new - Nieuwe sessie starten
resume - Een recente sessie hervatten
stop - Lopende opdracht onderbreken
status - Kijken waar Claude mee bezig is
retry - Laatste bericht opnieuw sturen
restart - Bot herstarten
```

**The bot talks Dutch.** Everything it sends to the chat — command replies,
status, errors, the resume list — is Dutch, and so are the defaults for
`THINKING_KEYWORDS`. The code, the comments and this documentation are English.
Translating the bot means the string literals in `src/handlers/` and the five
session strings in `src/session.ts`; there is no message catalogue to swap.

### 2. Required environment

```bash
TELEGRAM_BOT_TOKEN=1234567890:ABC-DEF...   # From @BotFather
TELEGRAM_ALLOWED_USERS=123456789           # Your Telegram user ID
OPENROUTER_API_KEY=sk-or-...               # Or ANTHROPIC_AUTH_TOKEN
```

Find your user ID by messaging [@userinfobot](https://t.me/userinfobot).

`OPENAI_API_KEY` is the only other one worth setting; without it voice and audio
are rejected. The rest of `.env.example` is optional tuning.

The container's paths are **not** environment config. `CLAUDE_WORKING_DIR` and
`STATE_DIR` are set in `deployment/Dockerfile` and are part of the image layout.
Overriding them in `.env` breaks the assumptions the Dockerfile makes.

### 3. The agent

```
agent/                 → /app/agent, the agent's working directory
├── CLAUDE.md          the agent's instructions       (image)
├── .claude/skills/    skills, auto-triggered         (image)
├── .claude/settings.json  permission rules           (image)
└── data/              everything that survives       (bind mount)
    ├── claude/        CLAUDE_CONFIG_DIR: transcripts and the agent's memory
    ├── telegram-bot/  downloads
    └── *.log, *.json  audit log, session pointer
```

`agent/` is copied into the image at build time, so `CLAUDE.md` and the skills
are versioned with the code: change them, rebuild, redeploy. `data/` is mounted
over from the host and is the only part that survives a deploy. The agent's
memory and its conversation transcripts are both inside it, under `data/claude/`.

Everything the agent touches is therefore under one directory, which is why the
SDK needs no `additionalDirectories` and there is no path allowlist to maintain.

### 4. MCP servers

`mcp/config.ts` is committed, not a template: one container, one agent, so the
server list is part of the build. Two servers ship with the repo and are enabled
by default:

| Server | Tool | What it does |
|---|---|---|
| `mcp/ask-user` | `ask_user(question, options)` | Renders the options as tappable inline buttons. The tap becomes the user's next message. |
| `mcp/send-file` | `send_file(file_path, caption?)` | Sends a file to the chat, picking photo/video/audio/document from the extension. Fire-and-forget, 50MB Telegram limit. |

They have dedicated support in the bot: `src/handlers/callback.ts` renders and
answers the buttons, `src/handlers/streaming.ts` picks up both handoffs, and
`src/session.ts` suppresses their tool-status lines so they read as UI rather
than tool calls. Both hand off through short-lived JSON files in `/tmp`, which is
deliberate — a handshake, not state worth persisting.

Add the agent's own servers to `mcp/config.ts`. A stdio server needs its binary
in the image, so add it to `deployment/Dockerfile` too.

## Provider setup

Every provider setting has a working default, so `OPENROUTER_API_KEY` is the
only one you have to touch. The rest, with their defaults:

```bash
# Endpoint. No trailing /v1 - the SDK appends /v1/messages itself, so a URL
# ending in /v1 gives a 404. Override this together with all three model
# variables to point at another Anthropic-compatible provider, Kimi included.
ANTHROPIC_BASE_URL=https://openrouter.ai/api

# The three tiers. Each has its own default, so switching provider means setting
# all three. Haiku serves the internal small/fast calls, so keep it cheap.
BOT_MODEL_SONNET=anthropic/claude-sonnet-5
BOT_MODEL_OPUS=anthropic/claude-opus-5
BOT_MODEL_HAIKU=anthropic/claude-haiku-4.5

# Which tier this session runs on: opus, sonnet or haiku. A raw model name also
# works, but then skips the tier mapping for the main loop.
BOT_MODEL_MAIN=sonnet

# Reasoning effort: low, medium, high, xhigh or max. An invalid value stops the
# bot at startup rather than silently falling back.
BOT_EFFORT_LEVEL=high

# Leave false. Set true only if a model returns a 400 naming the "thinking"
# field or another unrecognised request field.
BOT_DISABLE_ADAPTIVE_THINKING=false
BOT_DISABLE_EXPERIMENTAL_BETAS=false
```

With no key set, the bot falls back to whatever credentials Claude Code finds
locally, so a claude.ai login still works for development.

→ **[docs/provider.md](docs/provider.md)** covers why the credential goes in
`ANTHROPIC_AUTH_TOKEN`, how the model tiers resolve, where this setup deviates
from OpenRouter's guide, and how to switch to another provider.

## Bot commands

| Command | Description |
|---|---|
| `/start` | Show status and your user ID |
| `/new` | Start a fresh session |
| `/resume` | Pick from the last 5 sessions to resume, with a recap |
| `/stop` | Interrupt the current query |
| `/status` | Check what Claude is doing |
| `/retry` | Re-run the last message |
| `/restart` | Restart the bot |

## Deployment

Everything Docker-related lives in `deployment/`. `docker-compose.yml` is
gitignored, like `.env`, because the mount path and uid differ per host. Two
paths matter:

- **`/app/agent/data`** is bind-mounted from the host and holds the session file, audit
  log, Telegram downloads and the agent's memory. It is the only thing that
  survives a redeploy. Set `STATE_PATH` in `.env` to a directory outside the
  repository on a real host; it defaults to `./data` for local runs.
- **`/app/agent` is deliberately not mounted.** Instructions and skills come
  from `agent/` and are baked into the image, so a push rebuilds and ships them.
  Mounting over `/app/agent` would hide them.

`.dockerignore` stays in the repository root even though the Dockerfile does
not: Docker only reads it from the root of the build context.

The image deliberately omits `git` — it costs ~150MB once apt pulls in perl, and
an assistant-style agent never calls it. Add it to `deployment/Dockerfile` if
your agent works on repositories.

It is still around 950MB, and most of that is one file. Since v0.3 the agent SDK
ships the Claude Code CLI as a native binary of roughly 290MB, published as a
per-platform optional dependency. Two consequences worth knowing before you edit
the install step:

- **Both the glibc and the musl build get installed** for your architecture,
  because nothing in the package metadata tells bun which libc it is targeting.
  This image is Debian, so the musl one cannot run at all; the Dockerfile
  deletes it in the same layer as the install.
- **The binary is chosen for the platform you build on.** Building on arm64
  produces an arm64 image. Cross-building with `--platform` for a different
  architecture pulls the wrong binary, or none.

### Permissions on the deploy host

The container writes to `/app/agent/data` as a specific uid. A bind mount keeps the host's
ownership, so if that uid cannot write to the host directory, every write fails
with `EACCES`: no audit log, no saved session, and an agent that cannot remember
anything. The bot still starts, which makes this easy to miss.

Docker Desktop on macOS papers over the mismatch. On a Linux host it does not.
Two things prevent it:

```bash
# 1. Create the directory yourself. If Docker creates a missing bind-mount
#    source, it does so as root, and the container cannot write to it.
mkdir -p /srv/claude-telegram/data

# 2. Tell the container which uid to run as.
echo "STATE_PATH=/srv/claude-telegram/data" >> .env
echo "HOST_UID=$(id -u)" >> .env
echo "HOST_GID=$(id -g)" >> .env
```

`user:` in the compose file reads those two, defaulting to `1000:1000`. Both
steps belong in your deploy script, not in a runbook someone has to remember.

## Development

Type checking runs on the host; everything else runs in the container.

```bash
bun install        # Only for the type checker's dependencies
bun run typecheck  # tsc --noEmit
```

To try a code change, rebuild:

```bash
docker compose -f deployment/docker-compose.yml up -d --build
```

Running the bot outside the container is not supported. The paths it expects
(`/app/agent`, `/app/agent/data`) are the image's layout, and `pdftotext` and `unzip` are
installed there rather than on your machine.

## Security

> **This bot runs Claude Code with all permission prompts bypassed.** Whoever can
> send it a Telegram message can make it read, write and execute anything the
> process can reach. The allowlist is the perimeter.

Enforced in code: the user allowlist, rate limiting, the audit log, and the
container boundary. Inside the container nothing constrains the agent — the
template ships no path allowlist and no command filter, because a half-wired one
reads like protection and is not.

→ **[docs/security.md](docs/security.md)** for the full model, including the
three mechanisms that do work (`disallowedTools`, `PreToolUse` hooks, the
container) and where to put restrictions when you build an agent on this
template.

## Troubleshooting

Start with the logs: `docker compose -f deployment/docker-compose.yml logs -f`.

**Bot doesn't respond** — check your user ID is in `TELEGRAM_ALLOWED_USERS` and
that the container is up.

**401 from the provider** — the key is in the wrong variable. It belongs in
`OPENROUTER_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, which is sent as
`Authorization: Bearer`.

**Model not found** — the endpoint and the model names disagree. Changing
`ANTHROPIC_BASE_URL` without changing `BOT_MODEL_*` is the usual cause.

**Voice or audio fails** — `OPENAI_API_KEY` is missing, invalid, or out of
credit.

**MCP tools not working** — startup logs how many servers it loaded, or says it
found none. A stdio server also needs its binary in the image.

**The agent forgets everything after a deploy** — it wrote outside
`/app/agent/data`. Only that path is mounted, and the memory tools already write inside it.

**The agent ignores its instructions** — they have to be in `agent/`, which is
copied to `/app/agent`. A `CLAUDE.md` elsewhere in the repository is not read:
the SDK resolves it relative to `CLAUDE_WORKING_DIR`, and the code lives in
`/app`.

## Tracking upstream

```bash
git fetch upstream
git merge upstream/main
```

Expect conflicts. Upstream targets a macOS host with a LaunchAgent; this fork
targets a container and has had the host-specific code removed — `PATH`
injection for Homebrew, CLI auto-detection, `$HOME`-based default paths and the
standalone-build hooks. New here: `src/provider.ts`, `agent/`, `deployment/`,
and `mcp/` (upstream: `ask_user_mcp/`, `send_file_mcp/`,
`mcp-config.example.ts`). Also gone: upstream's `bunfig.toml`, which quarantined
npm releases younger than seven days.

## License

MIT. See [LICENSE](LICENSE).
