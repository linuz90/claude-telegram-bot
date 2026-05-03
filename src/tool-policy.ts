/**
 * Central policy for provider-independent native tools.
 */

import type { ToolDecision, ToolPolicyConfig, ToolRisk } from "./types";
import type { NativeToolMetadata } from "./native-tool-runtime";

export interface ToolPolicyResult {
  decision: ToolDecision;
  risk: ToolRisk;
  reason: string;
}

const DEFAULT_POLICY: ToolPolicyConfig = {
  read: "allow",
  write: "confirm",
  destructive: "deny",
  interactive: "deny",
  shell: "deny",
  file: "deny",
  unknown: "deny",
};

const CLAUDE_POLICY: ToolPolicyConfig = {
  ...DEFAULT_POLICY,
  write: "allow",
  destructive: "confirm",
  interactive: "allow",
  file: "allow",
};

const PROVIDER_POLICIES: Record<string, ToolPolicyConfig> = {
  claude: CLAUDE_POLICY,
  openai: DEFAULT_POLICY,
  codex: DEFAULT_POLICY,
  gemini: DEFAULT_POLICY,
};

function classifyByName(toolName: string): ToolRisk {
  const lower = toolName.toLowerCase();

  if (lower.includes("ask_user") || lower.includes("send_file")) {
    return "interactive";
  }
  if (lower.includes("bash") || lower.includes("shell") || lower.includes("terminal")) {
    return "shell";
  }
  if (lower.includes("read_file") || lower.includes("write_file") || lower.includes("edit_file")) {
    return lower.includes("read") ? "file" : "destructive";
  }
  if (
    lower.includes("delete") ||
    lower.includes("remove") ||
    lower.includes("invalidate") ||
    lower.includes("overwrite") ||
    lower.includes("destroy")
  ) {
    return "destructive";
  }
  if (
    lower.includes("save") ||
    lower.includes("update") ||
    lower.includes("create") ||
    lower.includes("add") ||
    lower.includes("write")
  ) {
    return "write";
  }
  if (
    lower.includes("search") ||
    lower.includes("list") ||
    lower.includes("status") ||
    lower.includes("recall") ||
    lower.includes("get") ||
    lower.includes("illuminate") ||
    lower.includes("query")
  ) {
    return "read";
  }

  return "unknown";
}

export function classifyTool(metadata: NativeToolMetadata): ToolRisk {
  const annotations = metadata.annotations;
  if (annotations?.destructiveHint) {
    return "destructive";
  }
  if (annotations?.readOnlyHint) {
    return "read";
  }
  return classifyByName(metadata.name);
}

export function evaluateToolPolicy(
  provider: string,
  metadata: NativeToolMetadata,
  override?: Partial<ToolPolicyConfig>
): ToolPolicyResult {
  const risk = classifyTool(metadata);
  const base = PROVIDER_POLICIES[provider] || DEFAULT_POLICY;
  const policy = { ...base, ...(override || {}) };
  const decision = policy[risk] || "deny";

  if (decision === "allow") {
    return {
      decision,
      risk,
      reason: `${risk} tool allowed for provider ${provider}`,
    };
  }

  if (decision === "confirm") {
    return {
      decision,
      risk,
      reason: `${risk} tool requires explicit user confirmation for provider ${provider}`,
    };
  }

  return {
    decision,
    risk,
    reason: `${risk} tool denied for provider ${provider}`,
  };
}
