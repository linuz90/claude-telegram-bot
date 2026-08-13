# Provider setup

The bot talks to any Anthropic-compatible endpoint. Kimi is the default. All of
this lives in `src/provider.ts`; the variables are listed in the README under
[Provider setup](../README.md#provider-setup).

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
That is why `BOT_MODEL_OPUS` and `BOT_MODEL_HAIKU` default to the sonnet value
instead of staying empty.

The `[1m]` suffix on a model name selects the 1M context window. Claude Code
strips it before resolving and puts it back afterwards.

## Deviations from Kimi's guide

[Use Kimi in Claude Code](https://platform.kimi.ai/docs/guide/claude-code-kimi)
is the source for this setup. Four of its recommendations are not followed.
Verified by reading the CLI that the SDK bundles
(`node_modules/@anthropic-ai/claude-agent-sdk/cli.js`, **v0.1.76**) — recheck
after an SDK upgrade.

| Guide says | Here | Why |
|---|---|---|
| set `CLAUDE_CODE_SUBAGENT_MODEL` | unset, and deleted from the child env | It short-circuits subagent model resolution before anything else, including a subagent that asks for a tier by name. With all tiers on one model the effect is identical; with a cheaper haiku tier it is not. |
| set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | skipped | The string does not occur in `cli.js`. No-op in this version. |
| set `ANTHROPIC_DEFAULT_FABLE_MODEL` | skipped | Same: not present in `cli.js`. The other three tier variables are. |
| `CLAUDE_CODE_EFFORT_LEVEL="max"` | `high` | The parser takes an integer or `low`/`medium`/`high`. Anything else fails validation and falls through to the default, so `"max"` silently means "unset". |

`ANTHROPIC_MODEL` from the guide is not needed either: the SDK passes
`options.model` to the CLI as `--model`, which covers the same slot.

## Models and thinking

Per Kimi's guide, `kimi-k3` has thinking on by default and needs nothing else.
`kimi-k2.7-code` requires thinking to be *enabled* and rejects requests without
it. `kimi-k2.6` runs fine with thinking off.

That matters here because thinking is keyword-driven: `getThinkingLevel()` in
`src/session.ts` returns 0 unless the message contains a trigger word from
`THINKING_KEYWORDS`, so `kimi-k2.7-code` will reject most messages.

If a model misbehaves:

| Symptom | Fix |
|---|---|
| 400 mentioning the `thinking` field | `BOT_DISABLE_ADAPTIVE_THINKING=true` |
| 400 naming another unrecognised field | also `BOT_DISABLE_EXPERIMENTAL_BETAS=true` |
| Broken or malformed tool calls | the model is not usable here |

## Switching providers

Override the endpoint and the model variables together:

```bash
ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1
BOT_MODEL_SONNET=anthropic/claude-sonnet-4.5
BOT_MODEL_OPUS=anthropic/claude-opus-4.1
BOT_MODEL_HAIKU=anthropic/claude-haiku-4.5
```

Leaving the models pointed at Kimi names while changing only the URL produces
model-not-found errors, not a fallback.
