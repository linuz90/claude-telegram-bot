/**
 * LLM provider configuration for the Claude Telegram Bot.
 *
 * Points the Claude Agent SDK at OpenRouter's Anthropic-compatible endpoint so
 * the bot authenticates with a static API key instead of a claude.ai login. That
 * removes the OAuth session refresh entirely and keeps production traffic off a
 * personal subscription.
 *
 * Everything below has a working default. In practice only OPENROUTER_API_KEY
 * has to be set. Overriding ANTHROPIC_BASE_URL and the model variables together
 * points the same machinery at any other Anthropic-compatible endpoint, Kimi
 * included.
 */

import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

// ============== Endpoint ==============

// No trailing "/v1". The SDK appends "/v1/messages" itself, so a base URL that
// already ends in /v1 produces /api/v1/v1/messages and a 404.
export const PROVIDER_BASE_URL =
  process.env.ANTHROPIC_BASE_URL || "https://openrouter.ai/api";

// The credential. OpenRouter, like Kimi, documents ANTHROPIC_AUTH_TOKEN rather
// than ANTHROPIC_API_KEY, and that is the right choice for a headless bot
// anyway: an auth token takes precedence immediately, while an API key asks for
// a one-time interactive approval that a bot can never give.
//
// KIMI_API_KEY still works, so an existing deployment keeps running until its
// .env is updated.
const PROVIDER_API_KEY =
  process.env.OPENROUTER_API_KEY ||
  process.env.ANTHROPIC_AUTH_TOKEN ||
  process.env.KIMI_API_KEY ||
  "";

export const PROVIDER_CONFIGURED = PROVIDER_API_KEY.length > 0;

// ============== Models ==============

// Claude Code resolves the aliases "opus", "sonnet" and "haiku" through three
// environment variables, and passes any other model string through untouched.
// Filling those three variables rebuilds Claude Code's normal tier system on top
// of the provider's models: the main loop, subagents that ask for a tier by
// name, and the internal small/fast calls all route through this mapping.
//
// OpenRouter model IDs are "vendor/model". Anthropic's own models are the safe
// default: OpenRouter documents this endpoint as built around them and warns
// that other vendors may not behave. Anything in its catalogue works.
const SONNET_MODEL =
  process.env.BOT_MODEL_SONNET || "anthropic/claude-sonnet-5";

// Each tier gets its own default rather than falling back to sonnet. An unset
// tier is not an unused tier: the resolver then returns a hardcoded Anthropic
// model ID, which fails the moment anything asks for that tier through a
// provider that has never heard of it. Haiku serves the internal small/fast
// calls, so it is worth keeping cheap.
//
// Because the three are independent, pointing the endpoint at another provider
// means setting all three - overriding only sonnet leaves the other two on
// Anthropic model IDs that provider will reject.
const OPUS_MODEL = process.env.BOT_MODEL_OPUS || "anthropic/claude-opus-5";
const HAIKU_MODEL = process.env.BOT_MODEL_HAIKU || "anthropic/claude-haiku-4.5";

// Which tier the session itself runs on. An alias keeps the whole stack on the
// mapping above; a raw model name is accepted too and then bypasses it for the
// main loop only.
export const BOT_MODEL_MAIN = process.env.BOT_MODEL_MAIN || "sonnet";

// ============== Reasoning ==============

// Passed to the SDK as `options.effort` in src/session.ts, not through the child
// environment.
//
// Anything outside this set is rejected at startup rather than silently falling
// back: a typo here costs reasoning quality on every message and is invisible
// otherwise.
const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

function parseEffortLevel(): EffortLevel {
  const raw = (process.env.BOT_EFFORT_LEVEL || "high").trim().toLowerCase();
  if (!EFFORT_LEVELS.includes(raw as EffortLevel)) {
    throw new Error(
      `BOT_EFFORT_LEVEL="${raw}" is not valid. Use one of: ${EFFORT_LEVELS.join(
        ", "
      )}`
    );
  }
  return raw as EffortLevel;
}

export const BOT_EFFORT_LEVEL = parseEffortLevel();

// ============== Compatibility escape hatches ==============

function envFlag(name: string): boolean {
  return (process.env[name] || "").trim().toLowerCase() === "true";
}

// OpenRouter passes thinking blocks and native tool use through to Anthropic, so
// these stay OFF by default. Turn one on only when a model rejects the
// corresponding request fields with a 400 - most likely with a non-Anthropic
// model behind the same endpoint.
export const ADAPTIVE_THINKING_DISABLED = envFlag(
  "BOT_DISABLE_ADAPTIVE_THINKING"
);
const EXPERIMENTAL_BETAS_DISABLED = envFlag("BOT_DISABLE_EXPERIMENTAL_BETAS");

// ============== Child Process Environment ==============

/**
 * Build the environment for the Claude Code process the SDK spawns.
 *
 * The TypeScript SDK REPLACES the child environment with whatever this returns,
 * so process.env has to be copied in first. Without that the child loses PATH
 * and every other inherited variable.
 */
export function buildProviderEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Without a key, leave auth untouched so a local claude.ai login still works.
  // Blanking these would actively break it: an empty credential variable still
  // wins over a saved login and authenticates with an empty value.
  if (!PROVIDER_CONFIGURED) {
    return env;
  }

  env.ANTHROPIC_BASE_URL = PROVIDER_BASE_URL;
  env.ANTHROPIC_AUTH_TOKEN = PROVIDER_API_KEY;
  // Must be explicitly empty, not unset: when it is unset Claude Code can fall
  // back to authenticating against Anthropic's own servers.
  env.ANTHROPIC_API_KEY = "";

  env.ANTHROPIC_DEFAULT_OPUS_MODEL = OPUS_MODEL;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = SONNET_MODEL;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = HAIKU_MODEL;
  // Claude Code reads this one first for its internal small/fast calls and only
  // then the haiku tier. Setting it to the same value reproduces the default
  // behaviour and stops a stray value from the host environment winning.
  env.ANTHROPIC_SMALL_FAST_MODEL = HAIKU_MODEL;

  // CLAUDE_CODE_SUBAGENT_MODEL is deliberately not set, even though both Kimi's
  // and OpenRouter's guides list it. It overrides every subagent
  // unconditionally, including ones that ask for a tier by name, which would
  // collapse the mapping above into a single model.
  delete env.CLAUDE_CODE_SUBAGENT_MODEL;

  if (ADAPTIVE_THINKING_DISABLED) {
    env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING = "1";
  }
  if (EXPERIMENTAL_BETAS_DISABLED) {
    env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1";
  }

  return env;
}

// ============== Startup Validation ==============

if (PROVIDER_CONFIGURED) {
  console.log(`Provider: ${PROVIDER_BASE_URL} (effort: ${BOT_EFFORT_LEVEL})`);
  console.log(
    `Models: main=${BOT_MODEL_MAIN} opus=${OPUS_MODEL} sonnet=${SONNET_MODEL} haiku=${HAIKU_MODEL}`
  );
} else {
  console.warn(
    "WARNING: no OPENROUTER_API_KEY or ANTHROPIC_AUTH_TOKEN set - falling back to whatever credentials Claude Code finds locally"
  );
}
