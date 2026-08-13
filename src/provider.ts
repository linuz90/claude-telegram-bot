/**
 * LLM provider configuration for the Claude Telegram Bot.
 *
 * Points the Claude Agent SDK at Kimi's Anthropic-compatible endpoint so the bot
 * authenticates with a static API key instead of a claude.ai login. That removes
 * the OAuth session refresh entirely and keeps production traffic off a personal
 * subscription.
 *
 * Everything below has a working default. In practice only KIMI_API_KEY has to
 * be set. Overriding ANTHROPIC_BASE_URL and the model variables together points
 * the same machinery at any other Anthropic-compatible endpoint, OpenRouter
 * included.
 */

import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

// ============== Endpoint ==============

export const PROVIDER_BASE_URL =
  process.env.ANTHROPIC_BASE_URL || "https://api.moonshot.ai/anthropic";

// The credential. Kimi documents ANTHROPIC_AUTH_TOKEN rather than
// ANTHROPIC_API_KEY, and that is the right choice for a headless bot anyway: an
// auth token takes precedence immediately, while an API key asks for a one-time
// interactive approval that a bot can never give.
const PROVIDER_API_KEY =
  process.env.KIMI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";

export const PROVIDER_CONFIGURED = PROVIDER_API_KEY.length > 0;

// ============== Models ==============

// Claude Code resolves the aliases "opus", "sonnet" and "haiku" through three
// environment variables, and passes any other model string through untouched.
// Filling those three variables rebuilds Claude Code's normal tier system on top
// of the provider's models: the main loop, subagents that ask for a tier by
// name, and the internal small/fast calls all route through this mapping.
//
// The "[1m]" suffix selects the 1M context window; Claude Code strips it before
// resolving and puts it back afterwards.
const SONNET_MODEL = process.env.BOT_MODEL_SONNET || "kimi-k3[1m]";

// Both fall back to the sonnet tier rather than staying unset. An unset tier is
// not an unused tier: the resolver then returns a hardcoded Anthropic model ID,
// which fails the moment anything asks for that tier through a provider that has
// never heard of it. Point haiku at something cheaper (kimi-k2.6) if the
// internal small/fast calls are not worth k3.
const OPUS_MODEL = process.env.BOT_MODEL_OPUS || SONNET_MODEL;
const HAIKU_MODEL = process.env.BOT_MODEL_HAIKU || SONNET_MODEL;

// Which tier the session itself runs on. An alias keeps the whole stack on the
// mapping above; a raw model name is accepted too and then bypasses it for the
// main loop only.
export const BOT_MODEL_MAIN = process.env.BOT_MODEL_MAIN || "sonnet";

// ============== Reasoning ==============

// Kimi recommends the highest reasoning effort for k3. Passed to the SDK as
// `options.effort` in src/session.ts, not through the child environment.
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

// Kimi's endpoint accepts thinking blocks and native tool use, so these stay OFF
// by default. Turn one on only when a model rejects the corresponding request
// fields with a 400.
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

  // CLAUDE_CODE_SUBAGENT_MODEL is deliberately not set, even though Kimi's guide
  // lists it. It overrides every subagent unconditionally, including ones that
  // ask for a tier by name, which would collapse the mapping above into a single
  // model. With all three tiers on one model the effect is identical anyway.
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
    "WARNING: no KIMI_API_KEY or ANTHROPIC_AUTH_TOKEN set - falling back to whatever credentials Claude Code finds locally"
  );
}
