/**
 * Configuration for Claude Telegram Bot.
 *
 * All environment variables, paths, constants, and safety settings.
 */

import { homedir } from "os";
import { resolve, dirname } from "path";
import type { LlmProviderConfig, McpServerConfig } from "./types";

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

export const WORKING_DIR = process.env.CLAUDE_WORKING_DIR || HOME;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || "";
export const LAST_MESSAGE_FILE =
  process.env.LAST_MESSAGE_FILE || `${WORKING_DIR}/.runtime/last-message.json`;
export const LLM_PROVIDER_FILE =
  process.env.LLM_PROVIDER_FILE || `${WORKING_DIR}/.runtime/llm-provider.json`;
export const OPENAI_CHAT_MODEL =
  process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
export const PRIMARY_LANGUAGE = (process.env.PRIMARY_LANGUAGE || "en")
  .trim()
  .toLowerCase();
export const RECENT_CONTEXT_KEYWORDS = (
  process.env.RECENT_CONTEXT_KEYWORDS ||
  "last message,latest message,last conversation,transcript,son mesaj,son mesaja,son mesajı,son mesaji,son konuşma,son konusma,transkript"
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

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

// ============== LLM Provider Configuration ==============

const BUILT_IN_LLM_PROVIDERS: Record<string, LlmProviderConfig> = {
  claude: {
    type: "claude-code",
    label: "Claude Code",
    description: "Full agent mode with tools, MCP, files, and terminal",
    tools: true,
  },
  openai: {
    type: "openai-chat",
    label: "OpenAI",
    description: "OpenAI chat with native MCP tools",
    model: OPENAI_CHAT_MODEL,
    apiKeyEnv: "OPENAI_API_KEY",
    tools: true,
  },
};

let LLM_PROVIDERS: Record<string, LlmProviderConfig> = {
  ...BUILT_IN_LLM_PROVIDERS,
};

try {
  const llmConfigPath = resolve(dirname(import.meta.dir), "llm-providers.ts");
  const llmModule = await import(llmConfigPath).catch(() => null);
  if (llmModule?.LLM_PROVIDERS) {
    LLM_PROVIDERS = {
      ...LLM_PROVIDERS,
      ...(llmModule.LLM_PROVIDERS as Record<string, LlmProviderConfig>),
    };
    console.log(
      `Loaded ${Object.keys(llmModule.LLM_PROVIDERS).length} LLM providers from llm-providers.ts`
    );
  }
} catch {
  console.log("No llm-providers.ts found - using built-in LLM providers");
}

export { LLM_PROVIDERS };

export type LlmProvider = string;
export const DEFAULT_LLM_PROVIDER: LlmProvider =
  process.env.DEFAULT_LLM_PROVIDER &&
  LLM_PROVIDERS[process.env.DEFAULT_LLM_PROVIDER]
    ? process.env.DEFAULT_LLM_PROVIDER
    : "claude";

// ============== Security Configuration ==============

// Allowed directories for file operations
const defaultAllowedPaths = [
  WORKING_DIR,
  `${HOME}/Documents`,
  `${HOME}/Downloads`,
  `${HOME}/Desktop`,
  `${HOME}/.claude`, // Claude Code data (plans, settings)
];

const allowedPathsStr = process.env.ALLOWED_PATHS || "";
export const ALLOWED_PATHS: string[] = allowedPathsStr
  ? allowedPathsStr
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
  : defaultAllowedPaths;

// Build safety prompt dynamically from ALLOWED_PATHS
function buildSafetyPrompt(allowedPaths: string[]): string {
  const pathsList = allowedPaths
    .map((p) => `   - ${p} (and subdirectories)`)
    .join("\n");

  const languageInstruction =
    `Use ${PRIMARY_LANGUAGE} as the default response language. If the user clearly writes in another language, reply in that language.`;

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

MEMORY PROTOCOL:
- When memory or knowledge MCP tools are available, use them before answering questions that depend on saved user, project, or long-term context.
- Prefer read/search/recall/list/status style tools before guessing from chat context.
- Save important new user preferences, project decisions, durable facts, and session summaries only when an appropriate non-destructive memory tool is available and policy allows it.
- ${languageInstruction}
- Do not hard-code assumptions about a specific memory provider. Choose tools based on their names, descriptions, schemas, and policy classification.
- If no relevant memory tool exists or policy blocks it, say that the configured tools cannot answer the saved-context request.

You are running via Telegram, so the user cannot easily undo mistakes. Be extra careful!
`;
}

export const SAFETY_PROMPT = buildSafetyPrompt(ALLOWED_PATHS);

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
The speaker may use the configured primary language (${PRIMARY_LANGUAGE}) and may mix in English technical terms.
Preserve simple spoken test phrases, words, and numbers literally.
Common spoken terms may include memory systems, project names, framework names, search, save, chapters, expectations, and reality.
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
export const STREAMING_THROTTLE_MS = 500; // Throttle streaming updates
export const BUTTON_LABEL_MAX_LENGTH = 30; // Max chars for inline button labels

// ============== Audit Logging ==============

export const AUDIT_LOG_PATH =
  process.env.AUDIT_LOG_PATH || "/tmp/claude-telegram-audit.log";
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

export const SESSION_FILE = "/tmp/claude-telegram-session.json";
export const RESTART_FILE = "/tmp/claude-telegram-restart.json";
export const TEMP_DIR = "/tmp/telegram-bot";

// Temp paths that are always allowed for bot operations
export const TEMP_PATHS = ["/tmp/", "/private/tmp/", "/var/folders/"];

// Ensure temp directory exists
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
  `Config loaded: ${ALLOWED_USERS.length} allowed users, working dir: ${WORKING_DIR}`
);
