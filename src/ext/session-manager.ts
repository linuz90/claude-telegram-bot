/**
 * Per-thread session routing.
 *
 * grammY's `ctx.msg`/`ctx.chat` getters already fold in `callbackQuery.message`,
 * so this covers regular messages, edited messages, and callback queries alike.
 * Replies need no extra routing: grammY's `ctx.reply*` shortcuts already add
 * `message_thread_id` for topic messages.
 *
 * Only `is_topic_message` marks a real topic: replies in a forum's General
 * topic and in regular supergroups also carry a reply-chain `message_thread_id`
 * (see https://github.com/grammyjs/grammY/pull/820).
 *
 * A message outside a Telegram forum topic always maps to the literal key
 * "default" — this is what makes the change non-disruptive to the bot's
 * existing single-session behavior and to the session history already saved
 * in /tmp/claude-telegram-session.json.
 */

import type { Context } from "grammy";
import { ClaudeSession } from "../session";

const sessions = new Map<string, ClaudeSession>();

export function keyForCtx(ctx: Context): string {
  const msg = ctx.msg;
  if (!msg?.is_topic_message || !msg.message_thread_id) return "default";
  const chatId = ctx.chat?.id ?? "unknown";
  return `${chatId}:${msg.message_thread_id}`;
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
