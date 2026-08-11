/**
 * LLM provider configuration for the Claude Telegram Bot.
 *
 * Points the Claude Agent SDK at an Anthropic-compatible endpoint (OpenRouter
 * by default) so the bot authenticates with a static API key instead of a
 * claude.ai login. That removes the OAuth session refresh entirely and keeps
 * production traffic off a personal subscription.
 */

// ============== Endpoint ==============

export const PROVIDER_BASE_URL =
  process.env.ANTHROPIC_BASE_URL || "https://openrouter.ai/api";

// The credential. OpenRouter documents ANTHROPIC_AUTH_TOKEN (not
// ANTHROPIC_API_KEY) for the Agent SDK, and that is also the right choice for a
// headless bot: an auth token takes precedence immediately, while an API key
// asks for one-time interactive approval that a bot can never give.
const PROVIDER_API_KEY =
  process.env.ANTHROPIC_AUTH_TOKEN || process.env.OPENROUTER_API_KEY || "";

export const PROVIDER_CONFIGURED = PROVIDER_API_KEY.length > 0;

// ============== Model ==============

// Passed straight through to the provider. Behind a custom base URL Claude Code
// does not validate model strings, so this accepts any OpenRouter slug:
// "anthropic/claude-sonnet-5", "moonshotai/kimi-k2-thinking", "z-ai/glm-4.6".
export const BOT_MODEL =
  process.env.BOT_MODEL || "anthropic/claude-sonnet-5";

// Model for subagents Claude Code spawns via the Task tool. Empty means it
// follows the main model.
const SUBAGENT_MODEL = process.env.BOT_SUBAGENT_MODEL || "";

// ============== Compatibility escape hatches ==============

function envFlag(name: string): boolean {
  return (process.env[name] || "").trim().toLowerCase() === "true";
}

// OpenRouter's "Anthropic skin" passes thinking blocks and native tool use
// through to the upstream model, so these stay OFF by default. Turn one on only
// when a specific model rejects the corresponding request fields with a 400.
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

  if (SUBAGENT_MODEL) {
    env.CLAUDE_CODE_SUBAGENT_MODEL = SUBAGENT_MODEL;
  }

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
  console.log(`Provider: ${PROVIDER_BASE_URL} (model: ${BOT_MODEL})`);
} else {
  console.warn(
    "WARNING: no OPENROUTER_API_KEY or ANTHROPIC_AUTH_TOKEN set - falling back to whatever credentials Claude Code finds locally"
  );
}
