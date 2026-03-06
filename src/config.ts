/**
 * Configuration for Claude Telegram Bot.
 *
 * All environment variables, paths, constants, and safety settings.
 */

import { homedir } from "os";
import { resolve, dirname, isAbsolute } from "path";
import type { McpServerConfig } from "./types";

// ============== Environment Setup ==============

const HOME = homedir();

// Ensure necessary paths are available for Claude's bash commands
// LaunchAgents don't inherit the full shell environment
const EXTRA_PATHS = [
  `${HOME}/.local/bin`,
  `${HOME}/.bun/bin`,
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
];

const currentPath = process.env.PATH || "";
const pathParts = currentPath.split(":");
for (const extraPath of EXTRA_PATHS) {
  if (!pathParts.includes(extraPath)) {
    pathParts.unshift(extraPath);
  }
}
process.env.PATH = pathParts.join(":");

// ============== Core Configuration ==============

export const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const ALLOWED_USERS: number[] = (
  process.env.TELEGRAM_ALLOWED_USERS || ""
)
  .split(",")
  .filter((x) => x.trim())
  .map((x) => parseInt(x.trim(), 10))
  .filter((x) => !isNaN(x));

// Keep backward compatibility with CLAUDE_WORKING_DIR while allowing a generic
// AI_WORKING_DIR for multi-assistant setups (Claude + Codex).
export const WORKING_DIR =
  process.env.AI_WORKING_DIR || process.env.CLAUDE_WORKING_DIR || HOME;

// Resolve user-provided paths relative to the assistant working directory.
// This keeps env overrides flexible while preserving a predictable base.
function resolveFromWorkingDir(rawPath: string): string {
  const value = rawPath.trim();
  const expanded = value.replace(/^~(?=\/|$)/, HOME);
  return isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(WORKING_DIR, expanded);
}

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const CLAUDE_ENABLE_CHROME =
  (process.env.CLAUDE_ENABLE_CHROME || "false").toLowerCase() === "true";
export const AI_ASSISTANT: "claude" | "codex" =
  (process.env.AI_ASSISTANT || "claude").toLowerCase() === "codex"
    ? "codex"
    : "claude";
export const CLAUDE_MODEL =
  process.env.CLAUDE_MODEL || "claude-opus-4-6";
export type ClaudeReasoningEffort = "low" | "medium" | "high";
const claudeEffortRaw = (process.env.CLAUDE_REASONING_EFFORT || "high")
  .toLowerCase()
  .trim();
export const CLAUDE_REASONING_EFFORT: ClaudeReasoningEffort =
  claudeEffortRaw === "low" ||
  claudeEffortRaw === "medium" ||
  claudeEffortRaw === "high"
    ? claudeEffortRaw
    : "high";
export const CODEX_MODEL = process.env.CODEX_MODEL || "gpt-5.3-codex";
export type CodexReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type CodexSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";
export type CodexApprovalPolicy =
  | "never"
  | "on-request"
  | "on-failure"
  | "untrusted";
export type CodexWebSearchMode = "disabled" | "cached" | "live";
const codexEffortRaw = (process.env.CODEX_REASONING_EFFORT || "medium")
  .toLowerCase()
  .trim();
export const CODEX_REASONING_EFFORT: CodexReasoningEffort =
  codexEffortRaw === "minimal" ||
  codexEffortRaw === "low" ||
  codexEffortRaw === "medium" ||
  codexEffortRaw === "high" ||
  codexEffortRaw === "xhigh"
    ? codexEffortRaw
    : "medium";
const codexSandboxRaw = (process.env.CODEX_SANDBOX_MODE || "workspace-write")
  .toLowerCase()
  .trim();
export const CODEX_SANDBOX_MODE: CodexSandboxMode =
  codexSandboxRaw === "read-only" ||
  codexSandboxRaw === "workspace-write" ||
  codexSandboxRaw === "danger-full-access"
    ? codexSandboxRaw
    : "workspace-write";
const codexApprovalRaw = (process.env.CODEX_APPROVAL_POLICY || "never")
  .toLowerCase()
  .trim();
export const CODEX_APPROVAL_POLICY: CodexApprovalPolicy =
  codexApprovalRaw === "never" ||
  codexApprovalRaw === "on-request" ||
  codexApprovalRaw === "on-failure" ||
  codexApprovalRaw === "untrusted"
    ? codexApprovalRaw
    : "never";
export const CODEX_NETWORK_ACCESS_ENABLED =
  (process.env.CODEX_NETWORK_ACCESS_ENABLED || "true").toLowerCase() ===
  "true";
const codexWebSearchRaw = (process.env.CODEX_WEB_SEARCH_MODE || "live")
  .toLowerCase()
  .trim();
export const CODEX_WEB_SEARCH_MODE: CodexWebSearchMode =
  codexWebSearchRaw === "disabled" ||
  codexWebSearchRaw === "cached" ||
  codexWebSearchRaw === "live"
    ? codexWebSearchRaw
    : "live";

// ============== Claude CLI Path ==============

// Auto-detect from PATH, or use environment override
function findClaudeCli(): string {
  const envPath = process.env.CLAUDE_CLI_PATH;
  if (envPath) return envPath;

  // Try to find claude in PATH using Bun.which
  const whichResult = Bun.which("claude");
  if (whichResult) return whichResult;

  // Final fallback
  return "/usr/local/bin/claude";
}

export const CLAUDE_CLI_PATH = findClaudeCli();

// ============== MCP Configuration ==============

// MCP servers loaded from mcp-config.ts
let MCP_SERVERS: Record<string, McpServerConfig> = {};

try {
  // Dynamic import of MCP config
  const mcpConfigPath = resolve(dirname(import.meta.dir), "mcp-config.ts");
  const mcpModule = await import(mcpConfigPath).catch(() => null);
  if (mcpModule?.MCP_SERVERS) {
    MCP_SERVERS = mcpModule.MCP_SERVERS;
    console.log(
      `Loaded ${Object.keys(MCP_SERVERS).length} MCP servers from mcp-config.ts`
    );
  }
} catch {
  console.log("No mcp-config.ts found - running without MCPs");
}

export { MCP_SERVERS };

// ============== Security Configuration ==============

function normalizeAllowedPath(rawPath: string): string | null {
  const value = rawPath.trim();
  if (!value) return null;
  return resolveFromWorkingDir(value);
}

function parseAllowedPaths(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((path) => normalizeAllowedPath(path))
    .filter((path): path is string => Boolean(path));
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

// Allowed directories for file operations.
// Defaults are intentionally narrow; use ALLOWED_PATHS_EXTRA / _REMOVE to tune.
const defaultAllowedPaths = dedupePaths(
  [
    WORKING_DIR,
    `${HOME}/Programming_Projects`,
    `${HOME}/.claude`, // Claude Code data (plans, settings)
    `${HOME}/.codex`, // Codex auth/session data
  ]
    .map((path) => normalizeAllowedPath(path))
    .filter((path): path is string => Boolean(path))
);

const allowedPathsOverride = parseAllowedPaths(process.env.ALLOWED_PATHS || "");
const allowedPathsExtra = parseAllowedPaths(process.env.ALLOWED_PATHS_EXTRA || "");
const allowedPathsRemove = new Set(
  parseAllowedPaths(process.env.ALLOWED_PATHS_REMOVE || "")
);
const normalizedWorkingDir = normalizeAllowedPath(WORKING_DIR);
const basePaths =
  allowedPathsOverride.length > 0 ? allowedPathsOverride : defaultAllowedPaths;
const mergedPaths = dedupePaths([...basePaths, ...allowedPathsExtra]).filter(
  (path) => !allowedPathsRemove.has(path)
);

if (normalizedWorkingDir && !mergedPaths.includes(normalizedWorkingDir)) {
  mergedPaths.unshift(normalizedWorkingDir);
}

export const ALLOWED_PATHS: string[] = mergedPaths;

// Build safety prompt dynamically from allowed paths and runtime/session paths.
function buildSafetyPrompt(
  allowedPaths: string[],
  sessionFile: string,
  runtimeDir: string,
  tempDir: string
): string {
  const pathsList = allowedPaths
    .map((p) => `   - ${p} (and subdirectories)`)
    .join("\n");

  return `
CRITICAL SAFETY RULES FOR TELEGRAM BOT:

1. NEVER delete, remove, or overwrite files without EXPLICIT confirmation from the user.
   - If user asks to delete something, respond: "Are you sure you want to delete [file]? Reply 'yes delete it' to confirm."
   - Only proceed with deletion if user replies with explicit confirmation like "yes delete it", "confirm delete"
   - This applies to: rm, trash, unlink, shred, or any file deletion

2. You can ONLY access files in these directories:
${pathsList}
   - REFUSE any file operations outside these paths

3. NEVER run dangerous commands like:
   - rm -rf (recursive force delete)
   - Any command that affects files outside allowed directories
   - Commands that could damage the system

4. For any destructive or irreversible action, ALWAYS ask for confirmation first.

5. Runtime/session files are stored here:
   - Session history for /resume: ${sessionFile}
   - Runtime root: ${runtimeDir}
   - Temporary media downloads: ${tempDir}
   - If the user asks where sessions are, report this exact location.

You are running via Telegram, so the user cannot easily undo mistakes. Be extra careful!
`;
}

// Dangerous command patterns to block
export const BLOCKED_PATTERNS = [
  "rm -rf /",
  "rm -rf ~",
  "rm -rf $HOME",
  "sudo rm",
  ":(){ :|:& };:", // Fork bomb
  "> /dev/sd",
  "mkfs.",
  "dd if=",
];

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

const thinkingKeywordsStr =
  process.env.THINKING_KEYWORDS || "think,pensa,ragiona";
const thinkingDeepKeywordsStr =
  process.env.THINKING_DEEP_KEYWORDS || "ultrathink,think hard,pensa bene";

export const THINKING_KEYWORDS = thinkingKeywordsStr
  .split(",")
  .map((k) => k.trim().toLowerCase());
export const THINKING_DEEP_KEYWORDS = thinkingDeepKeywordsStr
  .split(",")
  .map((k) => k.trim().toLowerCase());

// ============== Media Group Settings ==============

export const MEDIA_GROUP_TIMEOUT = 1000; // ms to wait for more photos in a group

// ============== Telegram Message Limits ==============

export const TELEGRAM_MESSAGE_LIMIT = 4096; // Max characters per message
export const TELEGRAM_SAFE_LIMIT = 4000; // Safe limit with buffer for formatting
// Stream update cadence; lower values show more frequent visible edits in Telegram.
export const STREAMING_THROTTLE_MS = parseInt(
  process.env.STREAMING_THROTTLE_MS || "250",
  10
);
// If provider sends only final text (no incremental deltas), simulate progressive edits.
export const STREAMING_SYNTHETIC_FALLBACK_MIN_CHARS = parseInt(
  process.env.STREAMING_SYNTHETIC_FALLBACK_MIN_CHARS || "280",
  10
);
export const STREAMING_SYNTHETIC_STEP_CHARS = parseInt(
  process.env.STREAMING_SYNTHETIC_STEP_CHARS || "220",
  10
);
export const STREAMING_SYNTHETIC_STEP_DELAY_MS = parseInt(
  process.env.STREAMING_SYNTHETIC_STEP_DELAY_MS || "80",
  10
);
export const STREAMING_DEBUG =
  (process.env.STREAMING_DEBUG || "false").toLowerCase() === "true";
export const BUTTON_LABEL_MAX_LENGTH = 30; // Max chars for inline button labels

// ============== Audit Logging ==============

export const RUNTIME_DIR = resolveFromWorkingDir(
  process.env.AI_RUNTIME_DIR || process.env.CLAUDE_RUNTIME_DIR || "sessions"
);
export const LEGACY_RUNTIME_DIR = resolveFromWorkingDir(".runtime");
export const AUDIT_LOG_PATH =
  process.env.AUDIT_LOG_PATH || `${RUNTIME_DIR}/claude-telegram-audit.log`;
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

export const SESSION_FILE = resolveFromWorkingDir(
  process.env.AI_SESSION_FILE || `${RUNTIME_DIR}/claude-telegram-session.json`
);
export const LEGACY_SESSION_FILES = Array.from(
  new Set([
    `${LEGACY_RUNTIME_DIR}/claude-telegram-session.json`,
    "/tmp/claude-telegram-session.json",
  ])
);
export const RESTART_FILE = resolveFromWorkingDir(
  process.env.AI_RESTART_FILE || `${RUNTIME_DIR}/claude-telegram-restart.json`
);
export const TEMP_DIR = resolveFromWorkingDir(
  process.env.AI_TEMP_DIR || `${RUNTIME_DIR}/telegram-bot`
);
export const SAFETY_PROMPT = buildSafetyPrompt(
  ALLOWED_PATHS,
  SESSION_FILE,
  RUNTIME_DIR,
  TEMP_DIR
);

// Temp paths that are always allowed for bot operations
export const TEMP_PATHS = [
  `${RUNTIME_DIR}/`,
  "/tmp/",
  "/private/tmp/",
  "/var/folders/",
];

// Ensure runtime/temp directories exist before the bot starts handling files.
await Bun.$`mkdir -p ${RUNTIME_DIR} ${TEMP_DIR}`;
await Bun.write(`${TEMP_DIR}/.keep`, "");

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
  `Config loaded: ${ALLOWED_USERS.length} allowed users, assistant: ${AI_ASSISTANT}, working dir: ${WORKING_DIR}`
);
