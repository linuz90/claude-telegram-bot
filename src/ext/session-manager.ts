/**
 * Per-thread session routing.
 *
 * grammY's `ctx.msg`/`ctx.chat` getters already fold in `callbackQuery.message`,
 * so a single `ctx.msg?.message_thread_id` read covers regular messages,
 * edited messages, and callback queries alike.
 *
 * A message with no `message_thread_id` (i.e. not inside a Telegram forum
 * topic) always maps to the literal key "default" — this is what makes the
 * change non-disruptive to the bot's existing single-session behavior and to
 * the session history already saved in /tmp/claude-telegram-session.json.
 */

import type { Context } from "grammy";
import { ClaudeSession } from "../session";

const sessions = new Map<string, ClaudeSession>();

export function keyForCtx(ctx: Context): string {
  const threadId = ctx.msg?.message_thread_id;
  if (!threadId) return "default";
  const chatId = ctx.chat?.id ?? "unknown";
  return `${chatId}:${threadId}`;
}

export function getSession(ctx: Context): ClaudeSession {
  const key = keyForCtx(ctx);
  let instance = sessions.get(key);
  if (!instance) {
    instance = new ClaudeSession(key);
    sessions.set(key, instance);
  }
  return instance;
}

/** Test-only: clears the instance cache so tests don't leak state between cases. */
export function _resetSessionsForTest(): void {
  sessions.clear();
}
