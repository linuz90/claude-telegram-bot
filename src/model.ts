/**
 * Runtime model selection.
 *
 * Resolution order: .model-override file (set via /model) > CLAUDE_MODEL env > default.
 *
 * Inputs are normalized and validated in code (never trusted raw): a bad
 * override string must not be able to take the bridge down. An invalid model
 * written via /model previously crashed every query with "process exited with
 * code 1" (e.g. "fable-5" instead of "claude-fable-5", 2026-07-19 outage).
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OVERRIDE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".model-override");

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";

// Friendly aliases → real model IDs.
const ALIASES: Record<string, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5",
  "fable-5": "claude-fable-5",
  "opus-4-8": "claude-opus-4-8",
  "sonnet-5": "claude-sonnet-5",
  "haiku-4-5": "claude-haiku-4-5",
};

/**
 * Normalize a requested model to something the CLI accepts, or null if it
 * can't be made valid. Full "claude-*" IDs pass through untouched.
 */
export function normalizeModel(model: string): string | null {
  const m = model.trim().toLowerCase();
  if (!m) return null;
  if (ALIASES[m]) return ALIASES[m];
  if (m.startsWith("claude-")) return m;
  return null;
}

export function currentModel(): string {
  try {
    if (existsSync(OVERRIDE_FILE)) {
      const raw = readFileSync(OVERRIDE_FILE, "utf8").trim();
      if (raw) {
        const normalized = normalizeModel(raw);
        if (normalized) return normalized;
        // Invalid override: ignore it rather than crash every query.
        console.error(
          `Invalid .model-override "${raw}" — ignoring, using ${DEFAULT_MODEL}`
        );
      }
    }
  } catch {}
  return DEFAULT_MODEL;
}

export function setModel(model: string | null): boolean {
  if (model) {
    const normalized = normalizeModel(model);
    if (!normalized) return false;
    writeFileSync(OVERRIDE_FILE, normalized + "\n");
    return true;
  }
  try { unlinkSync(OVERRIDE_FILE); } catch {}
  return true;
}
