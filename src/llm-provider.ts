/**
 * Runtime LLM provider switch.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  DEFAULT_LLM_PROVIDER,
  LLM_PROVIDERS,
  LLM_PROVIDER_FILE,
  type LlmProvider,
} from "./config";
import type { LlmProviderConfig } from "./types";

interface ProviderState {
  provider: LlmProvider;
  saved_at: string;
}

export function isLlmProvider(value: string): value is LlmProvider {
  return Boolean(LLM_PROVIDERS[value]);
}

export function getActiveLlmProvider(): LlmProvider {
  try {
    const state = JSON.parse(readFileSync(LLM_PROVIDER_FILE, "utf-8")) as
      Partial<ProviderState>;
    return state.provider && isLlmProvider(state.provider)
      ? state.provider
      : DEFAULT_LLM_PROVIDER;
  } catch {
    return DEFAULT_LLM_PROVIDER;
  }
}

export function setActiveLlmProvider(provider: LlmProvider): void {
  mkdirSync(dirname(LLM_PROVIDER_FILE), { recursive: true });
  const state: ProviderState = {
    provider,
    saved_at: new Date().toISOString(),
  };
  writeFileSync(LLM_PROVIDER_FILE, JSON.stringify(state, null, 2));
}

export function getLlmProviderConfig(
  provider = getActiveLlmProvider()
): LlmProviderConfig {
  return LLM_PROVIDERS[provider] || LLM_PROVIDERS[DEFAULT_LLM_PROVIDER]!;
}

export function getLlmProviderIds(): string[] {
  return Object.keys(LLM_PROVIDERS);
}

export function describeLlmProvider(provider = getActiveLlmProvider()): string {
  const config = getLlmProviderConfig(provider);
  const label = config.label || provider;
  const tools = config.tools ? "tools/MCP aktif" : "tools yok";
  const detail =
    config.type === "openai-chat"
      ? `model: ${config.model}`
      : config.type === "cli"
        ? `cli: ${config.command}`
        : "Claude Code agent";
  const description = config.description ? `, ${config.description}` : "";
  return `${label} (${detail}, ${tools}${description})`;
}

export function activeProviderHasTools(): boolean {
  return Boolean(getLlmProviderConfig().tools);
}
