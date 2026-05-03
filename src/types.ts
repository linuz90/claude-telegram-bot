/**
 * Shared TypeScript types for the Claude Telegram Bot.
 */

import type { Context } from "grammy";
import type { Message } from "grammy/types";

// Status callback for streaming updates
export type StatusCallback = (
  type: "thinking" | "tool" | "text" | "segment_end" | "done",
  content: string,
  segmentId?: number
) => Promise<void>;

// Rate limit bucket for token bucket algorithm
export interface RateLimitBucket {
  tokens: number;
  lastUpdate: number;
}

// Session persistence
export interface SavedSession {
  session_id: string;
  saved_at: string;
  working_dir: string;
  title: string; // First message truncated (max ~50 chars)
}

export interface SessionHistory {
  sessions: SavedSession[];
}

// Token usage from Claude
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

// MCP server configuration types
export type McpServerConfig = McpStdioConfig | McpHttpConfig;

export interface McpStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

// LLM provider configuration
export type LlmProviderKind = "claude-code" | "openai-chat" | "cli";

export type LlmProviderConfig =
  | ClaudeCodeProviderConfig
  | OpenAIChatProviderConfig
  | CliProviderConfig;

export interface BaseLlmProviderConfig {
  type: LlmProviderKind;
  label?: string;
  description?: string;
  tools?: boolean;
  toolPolicy?: Partial<ToolPolicyConfig>;
}

export interface ClaudeCodeProviderConfig extends BaseLlmProviderConfig {
  type: "claude-code";
}

export interface OpenAIChatProviderConfig extends BaseLlmProviderConfig {
  type: "openai-chat";
  model: string;
  apiKeyEnv?: string;
  baseURL?: string;
}

export interface CliProviderConfig extends BaseLlmProviderConfig {
  type: "cli";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  promptMode?: "stdin" | "arg-last";
  timeoutMs?: number;
}

// Native tool policy
export type ToolRisk = "read" | "write" | "destructive" | "interactive" | "shell" | "file" | "unknown";
export type ToolDecision = "allow" | "confirm" | "deny";

export interface ToolPolicyConfig {
  read: ToolDecision;
  write: ToolDecision;
  destructive: ToolDecision;
  interactive: ToolDecision;
  shell: ToolDecision;
  file: ToolDecision;
  unknown: ToolDecision;
}

// Audit log event types
export type AuditEventType =
  | "message"
  | "auth"
  | "tool_use"
  | "error"
  | "rate_limit";

export interface AuditEvent {
  timestamp: string;
  event: AuditEventType;
  user_id: number;
  username?: string;
  [key: string]: unknown;
}

// Pending media group for buffering albums
export interface PendingMediaGroup {
  items: string[];
  ctx: Context;
  caption?: string;
  statusMsg?: Message;
  timeout: Timer;
}

// Bot context with optional message
export type BotContext = Context;
