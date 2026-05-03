/**
 * Persistence for the last user prompt so /retry and "." survive restarts.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { LAST_MESSAGE_FILE } from "./config";

interface LastMessageState {
  message: string;
  saved_at: string;
}

export function saveLastMessage(message: string): void {
  try {
    mkdirSync(dirname(LAST_MESSAGE_FILE), { recursive: true });
    const state: LastMessageState = {
      message,
      saved_at: new Date().toISOString(),
    };
    writeFileSync(LAST_MESSAGE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn(`Failed to save last message: ${error}`);
  }
}

export function loadLastMessage(): string | null {
  try {
    const state = JSON.parse(readFileSync(LAST_MESSAGE_FILE, "utf-8")) as
      Partial<LastMessageState>;
    return typeof state.message === "string" && state.message.trim()
      ? state.message
      : null;
  } catch {
    return null;
  }
}
