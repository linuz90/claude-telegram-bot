/**
 * Optional LLM provider registry.
 *
 * Copy this file to llm-providers.ts and edit for your machine.
 * The bot always includes built-in "claude" and "openai" providers; entries here
 * override or extend that list.
 */

import type { LlmProviderConfig } from "./src/types";

export const LLM_PROVIDERS = {
  claude: {
    type: "claude-code",
    label: "Claude Code",
    description: "Full agent mode with tools, MCP, files, and terminal",
    tools: true,
  },

  codex: {
    type: "cli",
    label: "Codex CLI",
    description: "Local Codex CLI provider with native MCP tools.",
    command: "codex",
    args: ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-"],
    promptMode: "stdin",
    tools: true,
    timeoutMs: 180000,
  },

  gemini: {
    type: "cli",
    label: "Gemini CLI",
    description: "Local Gemini CLI provider with native MCP tools.",
    command: "gemini",
    args: ["--skip-trust", "-p"],
    env: {
      GEMINI_CLI_TRUST_WORKSPACE: "true",
    },
    promptMode: "arg-last",
    tools: true,
    timeoutMs: 180000,
  },

  openrouter: {
    type: "openai-chat",
    label: "OpenRouter",
    description: "OpenAI-compatible hosted provider with native MCP tools",
    model: "openai/gpt-4.1-mini",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseURL: "https://openrouter.ai/api/v1",
    tools: true,
  },

  local: {
    type: "openai-chat",
    label: "Local OpenAI-compatible",
    description: "LM Studio, Ollama OpenAI server, vLLM, etc. with native MCP tools.",
    model: "local-model",
    apiKeyEnv: "LOCAL_LLM_API_KEY",
    baseURL: "http://host.docker.internal:1234/v1",
    tools: true,
  },
} satisfies Record<string, LlmProviderConfig>;
