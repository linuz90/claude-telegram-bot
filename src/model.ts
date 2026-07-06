/**
 * Runtime model selection.
 *
 * Resolution order: .model-override file (set via /model) > CLAUDE_MODEL env > default.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OVERRIDE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".model-override");

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";

export function currentModel(): string {
  try {
    if (existsSync(OVERRIDE_FILE)) {
      const m = readFileSync(OVERRIDE_FILE, "utf8").trim();
      if (m) return m;
    }
  } catch {}
  return DEFAULT_MODEL;
}

export function setModel(model: string | null): void {
  if (model) {
    writeFileSync(OVERRIDE_FILE, model + "\n");
  } else {
    try { unlinkSync(OVERRIDE_FILE); } catch {}
  }
}
