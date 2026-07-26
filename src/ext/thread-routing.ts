/**
 * Forces every outgoing Bot API call to carry the correct `message_thread_id`
 * for the update currently being processed.
 *
 * Why this exists: grammY's own `ctx.reply()`/etc. shortcuts only attach
 * `message_thread_id` when `ctx.msg.is_topic_message` is true (see
 * node_modules/grammy/out/context.js). That flag is not reliably set on
 * every message inside a forum topic (e.g. it can be missing on a topic's
 * first message) even though `message_thread_id` itself is present - when
 * that happens, `ctx.reply()` silently drops the thread id and the reply
 * lands in the forum's "General" topic instead of the one the user is in,
 * which looks exactly like "threads don't work" even though session
 * isolation (src/ext/session-manager.ts) is unaffected and still correct.
 *
 * Fix: track the current update's thread id in AsyncLocalStorage and inject
 * it as a raw Bot API transformer (bot.api.config.use), one layer below all
 * of grammY's shortcuts, so every send-type call is threaded correctly
 * regardless of which shortcut produced it or what is_topic_message says.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Bot, Context, NextFunction } from "grammy";

// Bot API methods that accept message_thread_id (Telegram Bot API "send*"
// family, plus copy/forward). Methods outside this set (editMessageText,
// deleteMessage, answerCallbackQuery, getFile, ...) are keyed by message_id
// or don't apply to a specific topic, so they're left untouched.
export const THREAD_AWARE_METHODS = new Set([
  "sendMessage",
  "sendPhoto",
  "sendVideo",
  "sendAudio",
  "sendDocument",
  "sendVoice",
  "sendVideoNote",
  "sendAnimation",
  "sendSticker",
  "sendLocation",
  "sendVenue",
  "sendContact",
  "sendPoll",
  "sendDice",
  "sendInvoice",
  "sendGame",
  "sendMediaGroup",
  "sendChatAction",
  "copyMessage",
  "forwardMessage",
]);

const threadContext = new AsyncLocalStorage<number | undefined>();

/** The thread id captured for the update currently being processed, if any. */
export function currentThreadId(): number | undefined {
  return threadContext.getStore();
}

/** Must be registered before any handler that sends a reply. */
export async function threadContextMiddleware(
  ctx: Context,
  next: NextFunction
): Promise<void> {
  await threadContext.run(ctx.msg?.message_thread_id, next);
}

export function shouldInjectThreadId(
  method: string,
  payload: Record<string, unknown>
): boolean {
  return (
    THREAD_AWARE_METHODS.has(method) &&
    "chat_id" in payload &&
    !("message_thread_id" in payload)
  );
}

export function installThreadApiTransformer(bot: Bot): void {
  bot.api.config.use((prev, method, payload, signal) => {
    const threadId = currentThreadId();
    const p = payload as Record<string, unknown>;
    if (threadId !== undefined && shouldInjectThreadId(method, p)) {
      return prev(
        method,
        { ...p, message_thread_id: threadId } as typeof payload,
        signal
      );
    }
    return prev(method, payload, signal);
  });
}
