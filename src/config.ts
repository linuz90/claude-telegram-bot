/**
 * Configuration for Claude Telegram Bot.
 *
 * This bot runs in a container. The path defaults below are the image's layout,
 * not a host's: /app/agent is baked in by the Dockerfile and /app/agent/data is
 * bind-mounted. Overriding them is for tests, not for deployment.
 *
 * Everything the agent touches lives under its working directory, so there is
 * nothing to grant it access to. See docs/security.md for what does and does
 * not constrain the agent.
 */

import { resolve, dirname } from "path";
import type { McpServerConfig } from "./types";

// ============== Core Configuration ==============

export const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const ALLOWED_USERS: number[] = (
  process.env.TELEGRAM_ALLOWED_USERS || ""
)
  .split(",")
  .filter((x) => x.trim())
  .map((x) => parseInt(x.trim(), 10))
  .filter((x) => !isNaN(x));

// Where the agent works. The Dockerfile copies agent/ here, so this is also
// where CLAUDE.md and .claude/skills/ are resolved from.
export const WORKING_DIR = process.env.CLAUDE_WORKING_DIR || "/app/agent";

// Persistent runtime state: session file, audit log, Telegram downloads and the
// agent's memory. Bind-mounted from the host, and deliberately inside
// WORKING_DIR: everything the agent needs is then under its cwd, which is why
// the SDK needs no `additionalDirectories`.
export const STATE_DIR = (
  process.env.STATE_DIR || `${WORKING_DIR}/data`
).replace(/\/+$/, "");

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// ============== MCP Configuration ==============

// MCP servers loaded from mcp/config.ts, which is gitignored: copy
// mcp/config.example.ts to create it.
let MCP_SERVERS: Record<string, McpServerConfig> = {};

try {
  // Dynamic import of MCP config
  const mcpConfigPath = resolve(dirname(import.meta.dir), "mcp", "config.ts");
  const mcpModule = await import(mcpConfigPath).catch(() => null);
  if (mcpModule?.MCP_SERVERS) {
    MCP_SERVERS = mcpModule.MCP_SERVERS;
    console.log(
      `Loaded ${Object.keys(MCP_SERVERS).length} MCP servers from mcp/config.ts`
    );
  }
} catch {
  console.log("No mcp/config.ts found - running without MCPs");
}

export { MCP_SERVERS };

// ============== Timeouts ==============

// Query timeout (3 minutes)
export const QUERY_TIMEOUT_MS = 180_000;

// ============== Voice Transcription ==============

const BASE_TRANSCRIPTION_PROMPT = `Transcribe this voice message accurately.
The speaker may use multiple languages (English, and possibly others).
Focus on accuracy for proper nouns, technical terms, and commands.`;

let TRANSCRIPTION_CONTEXT = "";
if (process.env.TRANSCRIPTION_CONTEXT_FILE) {
  try {
    const file = Bun.file(process.env.TRANSCRIPTION_CONTEXT_FILE);
    if (await file.exists()) {
      TRANSCRIPTION_CONTEXT = (await file.text()).trim();
    }
  } catch {
    // File not found or unreadable — proceed without context
  }
}

export const TRANSCRIPTION_PROMPT = TRANSCRIPTION_CONTEXT
  ? `${BASE_TRANSCRIPTION_PROMPT}\n\nAdditional context:\n${TRANSCRIPTION_CONTEXT}`
  : BASE_TRANSCRIPTION_PROMPT;

export const TRANSCRIPTION_AVAILABLE = !!OPENAI_API_KEY;

// ============== Thinking Keywords ==============

// Add your own language here rather than replacing these: the list is matched
// as substrings, so a word from another language costs nothing until it appears
// in a message.
// Matched as substrings, so every phrasing has to be listed: "denk goed na"
// does not contain "denk na". Deep keywords are checked first, so a phrase that
// appears in both lists resolves to deep.
const thinkingKeywordsStr =
  process.env.THINKING_KEYWORDS || "think,denk na,denk goed na";
const thinkingDeepKeywordsStr =
  process.env.THINKING_DEEP_KEYWORDS ||
  "ultrathink,think hard,denk diep na,denk heel goed na";

export const THINKING_KEYWORDS = thinkingKeywordsStr
  .split(",")
  .map((k) => k.trim().toLowerCase());
export const THINKING_DEEP_KEYWORDS = thinkingDeepKeywordsStr
  .split(",")
  .map((k) => k.trim().toLowerCase());

// ============== Claude Code Config Directory ==============

// Where the CLI keeps its own state, including the conversation transcripts
// that `resume` reads. The Dockerfile points this at the volume; without that
// it defaults to $HOME/.claude, which lives in the container layer and is
// destroyed by every rebuild - taking every resumable conversation with it.
export const CLAUDE_CONFIG_DIR =
  process.env.CLAUDE_CONFIG_DIR || `${STATE_DIR}/claude`;

// The CLI stores transcripts per working directory, in a folder named after the
// path with every non-alphanumeric character replaced by a dash: /app/agent
// becomes -app-agent.
export const TRANSCRIPT_DIR = `${CLAUDE_CONFIG_DIR}/projects/${WORKING_DIR.replace(
  /[^a-zA-Z0-9]/g,
  "-"
)}`;

// ============== Media Group Settings ==============

export const MEDIA_GROUP_TIMEOUT = 1000; // ms to wait for more photos in a group

// ============== Telegram Message Limits ==============

export const TELEGRAM_MESSAGE_LIMIT = 4096; // Max characters per message
export const TELEGRAM_SAFE_LIMIT = 4000; // Safe limit with buffer for formatting
export const STREAMING_THROTTLE_MS = 500; // Throttle streaming updates
export const BUTTON_LABEL_MAX_LENGTH = 30; // Max chars for inline button labels

// ============== Audit Logging ==============

export const AUDIT_LOG_PATH =
  process.env.AUDIT_LOG_PATH || `${STATE_DIR}/claude-telegram-audit.log`;
export const AUDIT_LOG_JSON =
  (process.env.AUDIT_LOG_JSON || "false").toLowerCase() === "true";

// ============== Rate Limiting ==============

export const RATE_LIMIT_ENABLED =
  (process.env.RATE_LIMIT_ENABLED || "true").toLowerCase() === "true";
export const RATE_LIMIT_REQUESTS = parseInt(
  process.env.RATE_LIMIT_REQUESTS || "20",
  10
);
export const RATE_LIMIT_WINDOW = parseInt(
  process.env.RATE_LIMIT_WINDOW || "60",
  10
);

// ============== File Paths ==============

export const SESSION_FILE = `${STATE_DIR}/claude-telegram-session.json`;
export const RESTART_FILE = `${STATE_DIR}/claude-telegram-restart.json`;
// Where Telegram downloads (photos, documents, voice notes) land before the
// agent reads them.
export const TEMP_DIR = `${STATE_DIR}/telegram-bot`;

// The agent's persistent memory.
//
// This is Claude Code's own memory directory, not a convention of this
// template. The CLI derives it from CLAUDE_CONFIG_DIR and the working
// directory, and its system prompt points the agent here. Do not relocate it
// and document something else: an agent follows the system prompt over its
// CLAUDE.md, correctly, and you end up with notes in two places.
//
// It sits under STATE_DIR because CLAUDE_CONFIG_DIR does, so it is on the
// volume and survives a redeploy.
export const MEMORY_DIR = `${TRANSCRIPT_DIR}/memory`;

// Created here rather than in the Dockerfile: STATE_DIR is a bind mount, so
// anything the image puts there is replaced by the host directory.
await Bun.write(`${TEMP_DIR}/.keep`, "");
await Bun.write(`${MEMORY_DIR}/.keep`, "");

// ============== Validation ==============

if (!TELEGRAM_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN environment variable is required");
  process.exit(1);
}

if (ALLOWED_USERS.length === 0) {
  console.error(
    "ERROR: TELEGRAM_ALLOWED_USERS environment variable is required"
  );
  process.exit(1);
}

console.log(
  `Config loaded: ${ALLOWED_USERS.length} allowed users, working dir: ${WORKING_DIR}`
);
