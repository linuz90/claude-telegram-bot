# Provider setup

The bot talks to any Anthropic-compatible endpoint. OpenRouter is the default.
All of this lives in `src/provider.ts`; the variables are listed in the README
under [Provider setup](../README.md#provider-setup).

The base URL is `https://openrouter.ai/api`, **without** a trailing `/v1`. The
SDK appends `/v1/messages` itself, so `.../api/v1` becomes
`/api/v1/v1/messages`, which is a 404. Verified: `POST /api/v1/messages` returns
401, `POST /api/v1/v1/messages` returns 404.

## Why a static key instead of a claude.ai login

A claude.ai subscription may not be used for production workloads, and its OAuth
session needs periodic re-authentication. A static API key does not.

The key goes in `ANTHROPIC_AUTH_TOKEN`, not `ANTHROPIC_API_KEY`. Both work over
the wire, but the auth token takes precedence immediately, while the API key
triggers a one-time interactive approval prompt that a headless bot can never
answer. `ANTHROPIC_API_KEY` is then set to an empty string rather than left
unset: unset makes Claude Code fall back to authenticating against Anthropic's
own servers.

With no key set at all, `buildProviderEnv()` leaves auth untouched, so a local
claude.ai login still works for development.

## Model tiers

Claude Code resolves the aliases `opus`, `sonnet` and `haiku` through three
environment variables and passes any other model string through untouched.
`src/provider.ts` fills those variables, so the tier system works as usual with
the provider's models underneath: the main loop, subagents that declare
`model: 'haiku'`, and the internal small/fast calls all route through it.

An unset tier is not an unused tier. The resolver falls back to a hardcoded
Anthropic model ID, which fails against a provider that has never heard of it.
That is why all three of `BOT_MODEL_SONNET`, `BOT_MODEL_OPUS` and
`BOT_MODEL_HAIKU` carry their own default instead of staying empty:

| Tier | Default |
|---|---|
| sonnet | `anthropic/claude-sonnet-5` |
| opus | `anthropic/claude-opus-5` |
| haiku | `anthropic/claude-haiku-4.5` |

OpenRouter model IDs are `vendor/model`. Anthropic's own models are the default
because OpenRouter documents this endpoint as built around them and warns that
other vendors may not behave; anything in its catalogue works.

Because the three are independent, switching provider means setting all three.
Overriding only sonnet leaves the other two on Anthropic IDs the new provider
will reject.

The `[1m]` suffix on a model name selects the 1M context window. Claude Code
strips it before resolving and puts it back afterwards.

## Deviations from the provider guides

[OpenRouter's Claude Code integration](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration)
is the source for this setup. One of its recommendations is not followed.

| Guide says | Here | Why |
|---|---|---|
| set `CLAUDE_CODE_SUBAGENT_MODEL` | unset, and deleted from the child env | It short-circuits subagent model resolution before anything else, including a subagent that asks for a tier by name. With all tiers on one model the effect is identical; with a cheaper haiku tier it is not. |

`ANTHROPIC_MODEL` from the guide is not needed either: the SDK passes
`options.model` to the CLI as `--model`, which covers the same slot.

Two more of OpenRouter's variables are left out. `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`
lets the CLI list the gateway's catalogue, which a bot with three fixed tiers
never needs, and `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK` only matters for the
interactive `/fast` command. Set either in `.env` if you want them; nothing here
strips them.

`CLAUDE_CODE_EFFORT_LEVEL` is not set either, but for a different reason: effort
is an SDK option now (`options.effort` in `src/session.ts`), so the environment
variable is the older of two routes to the same setting.

### Verifying this against the CLI

The three remaining guide recommendations —
`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `ANTHROPIC_DEFAULT_FABLE_MODEL` and an
effort level of `max` — were all no-ops on SDK v0.1.76 and all work as of
**v0.3.229** (CLI 2.1.223). Recheck after an upgrade; the CLI is versioned
separately from the SDK wrapper and neither changelog covers this.

There is no `cli.js` to read any more. Since v0.3 the CLI ships as a native
binary in a per-platform package, so grep the binary instead:

```bash
strings -a node_modules/@anthropic-ai/claude-agent-sdk-*/claude \
  | grep -c CLAUDE_CODE_AUTO_COMPACT_WINDOW
```

`node_modules/@anthropic-ai/claude-agent-sdk/manifest.json` gives the CLI
version and build date behind a given SDK release.

## Models and thinking

OpenRouter passes thinking blocks and native tool use straight through to
Anthropic, so the defaults need no adjustment.

It matters for other vendors behind the same endpoint, because thinking here is
keyword-driven: `getThinkingLevel()` in `src/session.ts` returns 0 unless the
message contains a trigger word from `THINKING_KEYWORDS`. A model that *requires*
thinking to be enabled — Kimi's `kimi-k2.7-code`, for one — will reject most
messages.

If a model misbehaves:

| Symptom | Fix |
|---|---|
| 400 mentioning the `thinking` field | `BOT_DISABLE_ADAPTIVE_THINKING=true` |
| 400 naming another unrecognised field | also `BOT_DISABLE_EXPERIMENTAL_BETAS=true` |
| Broken or malformed tool calls | the model is not usable here |

## Switching providers

Override the endpoint and all three model variables together. Kimi, for example:

```bash
ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic
BOT_MODEL_SONNET=kimi-k3[1m]
BOT_MODEL_OPUS=kimi-k3[1m]
BOT_MODEL_HAIKU=kimi-k2.6
```

Changing only the URL produces model-not-found errors, not a fallback.

The credential is read from `OPENROUTER_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or
`KIMI_API_KEY`, in that order, so an existing deployment keeps working until its
`.env` is updated.
