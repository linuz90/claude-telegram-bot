/**
 * Tool restrictions for the Claude Telegram Bot.
 *
 * The bot runs in `bypassPermissions` mode so it never blocks waiting for a
 * human. Two mechanisms still apply in that mode and both are used here:
 *
 *   1. Deny rules (`disallowedTools`) - static patterns, blocked in every
 *      permission mode including bypassPermissions.
 *   2. PreToolUse hooks - run before every other step in the permission flow,
 *      and a hook deny also holds in bypassPermissions.
 *
 * A `canUseTool` callback would NOT work here: under bypassPermissions it is
 * never reached, and the SDK warns about that with CLAUDE_SDK_CAN_USE_TOOL_SHADOWED.
 */

import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { TEMP_PATHS } from "./config";
import { checkCommandSafety, isPathAllowed } from "./security";

// ============== Static Deny Rules ==============

/**
 * Patterns denied before the tool ever runs.
 *
 * These are prefix globs over the command string, so they catch the direct
 * form (`rm -rf /`) but not a chained one (`foo && rm -rf /`). The PreToolUse
 * hook below is what covers the rest; treat these as the cheap first layer.
 */
export const DENY_RULES: string[] = [
  "Bash(sudo *)",
  "Bash(rm -rf /*)",
  "Bash(rm -rf ~*)",
  "Bash(rm -fr /*)",
  "Bash(mkfs*)",
  "Bash(dd if=*)",
  "Bash(shutdown*)",
  "Bash(reboot*)",
  "Bash(chmod -R 777 /*)",
];

// ============== Secret File Protection ==============

/**
 * Files the agent must never read or write, even inside ALLOWED_PATHS.
 * Credentials stay out of the model's context entirely.
 */
const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env($|\.|\/)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.credentials\.json$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)secrets?\.(ya?ml|json)$/i,
];

function isSecretPath(path: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(path));
}

// Tools that take a `file_path` argument.
const FILE_TOOLS = new Set(["Read", "Write", "Edit", "NotebookEdit"]);

// ============== PreToolUse Hook ==============

function deny(input: PreToolUseHookInput, reason: string) {
  console.warn(`BLOCKED [${input.tool_name}]: ${reason}`);
  return {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name,
      permissionDecision: "deny" as const,
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Gate every tool call. Runs before deny rules, allow rules and the permission
 * mode, so this is the one place that sees all of them.
 */
const guardToolUse: HookCallback = async (input) => {
  const preInput = input as PreToolUseHookInput;
  const toolInput = (preInput.tool_input ?? {}) as Record<string, unknown>;
  const toolName = preInput.tool_name;

  // Shell commands: reuse the existing pattern and rm-path checks.
  if (toolName === "Bash") {
    const command = String(toolInput.command || "");
    const [safe, reason] = checkCommandSafety(command);
    if (!safe) {
      return deny(preInput, reason);
    }
    return {};
  }

  // File operations: block credentials, then enforce ALLOWED_PATHS.
  if (FILE_TOOLS.has(toolName)) {
    const filePath = String(toolInput.file_path || "");
    if (!filePath) {
      return {};
    }

    if (isSecretPath(filePath)) {
      return deny(
        preInput,
        `Access to credential files is blocked: ${filePath}`
      );
    }

    // Reads from the bot's own temp dirs are expected: that is where Telegram
    // downloads (photos, documents, voice notes) land before Claude sees them.
    const isTempRead =
      toolName === "Read" &&
      (TEMP_PATHS.some((p) => filePath.startsWith(p)) ||
        filePath.includes("/.claude/"));

    if (!isTempRead && !isPathAllowed(filePath)) {
      return deny(
        preInput,
        `Path is outside the allowed directories: ${filePath}`
      );
    }
  }

  return {};
};

/**
 * Hook configuration for the Agent SDK `hooks` option.
 * No matcher, so it fires for every tool call.
 */
export function createPermissionHooks() {
  return {
    PreToolUse: [{ hooks: [guardToolUse] }],
  };
}
