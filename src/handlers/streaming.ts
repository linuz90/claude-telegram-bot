/**
 * Shared streaming callback for Claude Telegram Bot handlers.
 *
 * Provides a reusable status callback for streaming Claude responses.
 */

import type { Context } from "grammy";
import type { Message } from "grammy/types";
import { InlineKeyboard } from "grammy";
import type { StatusCallback } from "../types";
import { convertMarkdownToHtml, escapeHtml } from "../formatting";
import {
  TELEGRAM_MESSAGE_LIMIT,
  TELEGRAM_SAFE_LIMIT,
  STREAMING_DEBUG,
  STREAMING_THROTTLE_MS,
  BUTTON_LABEL_MAX_LENGTH,
} from "../config";

/**
 * Create inline keyboard for ask_user options.
 */
export function createAskUserKeyboard(
  requestId: string,
  options: string[]
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let idx = 0; idx < options.length; idx++) {
    const option = options[idx]!;
    // Truncate long options for button display
    const display =
      option.length > BUTTON_LABEL_MAX_LENGTH
        ? option.slice(0, BUTTON_LABEL_MAX_LENGTH) + "..."
        : option;
    const callbackData = `askuser:${requestId}:${idx}`;
    keyboard.text(display, callbackData).row();
  }
  return keyboard;
}

/**
 * Check for pending ask-user requests and send inline keyboards.
 */
export async function checkPendingAskUserRequests(
  ctx: Context,
  chatId: number
): Promise<boolean> {
  const glob = new Bun.Glob("ask-user-*.json");
  let buttonsSent = false;

  for await (const filename of glob.scan({ cwd: "/tmp", absolute: false })) {
    const filepath = `/tmp/${filename}`;
    try {
      const file = Bun.file(filepath);
      const text = await file.text();
      const data = JSON.parse(text);

      // Only process pending requests for this chat
      if (data.status !== "pending") continue;
      if (String(data.chat_id) !== String(chatId)) continue;

      const question = data.question || "Please choose:";
      const options = data.options || [];
      const requestId = data.request_id || "";

      if (options.length > 0 && requestId) {
        const keyboard = createAskUserKeyboard(requestId, options);
        await ctx.reply(`❓ ${question}`, { reply_markup: keyboard });
        buttonsSent = true;

        // Mark as sent
        data.status = "sent";
        await Bun.write(filepath, JSON.stringify(data));
      }
    } catch (error) {
      console.warn(`Failed to process ask-user file ${filepath}:`, error);
    }
  }

  return buttonsSent;
}

/**
 * Tracks state for streaming message updates.
 */
export class StreamingState {
  previewMessage: Message | null = null; // single editable streaming message
  toolMessages: Message[] = []; // ephemeral tool status messages
  segmentText = new Map<number, string>(); // segment_id -> latest text for that segment
  lastEditTime = 0; // last preview edit timestamp
  lastContent = ""; // last sent preview content
}

/**
 * Format content for Telegram, ensuring it fits within the message limit.
 * Truncates raw content and re-converts if HTML output exceeds the limit.
 */
function formatWithinLimit(
  content: string,
  safeLimit: number = TELEGRAM_SAFE_LIMIT
): string {
  let display =
    content.length > safeLimit ? content.slice(0, safeLimit) + "..." : content;
  let formatted = convertMarkdownToHtml(display);

  // HTML tags can inflate content beyond the limit - shrink until it fits
  if (formatted.length > TELEGRAM_MESSAGE_LIMIT) {
    const ratio = TELEGRAM_MESSAGE_LIMIT / formatted.length;
    display = content.slice(0, Math.floor(safeLimit * ratio * 0.95)) + "...";
    formatted = convertMarkdownToHtml(display);
  }

  return formatted;
}

/**
 * Split long formatted content into chunks and send as separate messages.
 */
async function sendChunkedMessages(
  ctx: Context,
  content: string
): Promise<void> {
  // Split on markdown content first, then format each chunk
  for (let i = 0; i < content.length; i += TELEGRAM_SAFE_LIMIT) {
    const chunk = content.slice(i, i + TELEGRAM_SAFE_LIMIT);
    try {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    } catch {
      // HTML failed (possibly broken tags from split) - try plain text
      try {
        await ctx.reply(chunk);
      } catch (plainError) {
        console.debug("Failed to send chunk:", plainError);
      }
    }
  }
}

/**
 * Create a status callback for streaming updates.
 */
export function createStatusCallback(
  ctx: Context,
  state: StreamingState
): StatusCallback {
  const getCombinedText = (): string => {
    const ordered = [...state.segmentText.entries()].sort((a, b) => a[0] - b[0]);
    return ordered
      .map(([, text]) => text.trim())
      .filter(Boolean)
      .join("\n\n");
  };

  const upsertPreview = async (text: string, force: boolean): Promise<void> => {
    if (!text) return;

    const now = Date.now();
    if (!force && now - state.lastEditTime <= STREAMING_THROTTLE_MS) {
      if (STREAMING_DEBUG) {
        console.log(
          `[stream-debug] preview throttle skip age=${now - state.lastEditTime}ms`
        );
      }
      return;
    }

    const display =
      text.length > TELEGRAM_SAFE_LIMIT
        ? text.slice(0, TELEGRAM_SAFE_LIMIT) + "..."
        : text;
    const formatted = convertMarkdownToHtml(display);
    if (formatted === state.lastContent) return;

    if (!state.previewMessage) {
      try {
        state.previewMessage = await ctx.reply(formatted, { parse_mode: "HTML" });
      } catch (htmlError) {
        console.debug("HTML preview create failed, using plain text:", htmlError);
        state.previewMessage = await ctx.reply(formatted);
      }
      state.lastContent = formatted;
      state.lastEditTime = now;
      if (STREAMING_DEBUG) {
        console.log(
          `[stream-debug] preview created msg=${state.previewMessage.message_id} len=${text.length} force=${force}`
        );
      }
      return;
    }

    try {
      await ctx.api.editMessageText(
        state.previewMessage.chat.id,
        state.previewMessage.message_id,
        formatted,
        { parse_mode: "HTML" }
      );
      state.lastContent = formatted;
    } catch (htmlError) {
      console.debug("HTML preview edit failed, trying plain text:", htmlError);
      try {
        await ctx.api.editMessageText(
          state.previewMessage.chat.id,
          state.previewMessage.message_id,
          formatted
        );
        state.lastContent = formatted;
      } catch (editError) {
        console.debug("Preview edit failed:", editError);
      }
    }
    state.lastEditTime = now;
    if (STREAMING_DEBUG) {
      console.log(
        `[stream-debug] preview edited msg=${state.previewMessage.message_id} len=${text.length} force=${force}`
      );
    }
  };

  const finalizePreview = async (): Promise<void> => {
    if (!state.previewMessage) return;

    const finalText = getCombinedText();
    if (!finalText) return;

    const formatted = convertMarkdownToHtml(finalText);
    if (formatted.length <= TELEGRAM_MESSAGE_LIMIT) {
      if (formatted === state.lastContent) return;
      try {
        await ctx.api.editMessageText(
          state.previewMessage.chat.id,
          state.previewMessage.message_id,
          formatted,
          { parse_mode: "HTML" }
        );
      } catch (error) {
        console.debug("Failed to finalize preview with HTML:", error);
      }
      if (STREAMING_DEBUG) {
        console.log(
          `[stream-debug] preview finalized in-place msg=${state.previewMessage.message_id} len=${finalText.length}`
        );
      }
      return;
    }

    try {
      await ctx.api.deleteMessage(
        state.previewMessage.chat.id,
        state.previewMessage.message_id
      );
    } catch (error) {
      console.debug("Failed to delete long preview before chunking:", error);
    }

    for (let i = 0; i < formatted.length; i += TELEGRAM_SAFE_LIMIT) {
      const chunk = formatted.slice(i, i + TELEGRAM_SAFE_LIMIT);
      try {
        await ctx.reply(chunk, { parse_mode: "HTML" });
      } catch (htmlError) {
        console.debug("HTML final chunk failed, using plain text:", htmlError);
        await ctx.reply(chunk);
      }
    }
    if (STREAMING_DEBUG) {
      console.log(
        `[stream-debug] preview finalized by chunk-split len=${finalText.length}`
      );
    }
    state.previewMessage = null;
  };

  return async (statusType: string, content: string, segmentId?: number) => {
    try {
      if (statusType === "thinking") {
        // Show thinking inline, compact (first 500 chars)
        const preview =
          content.length > 500 ? content.slice(0, 500) + "..." : content;
        const escaped = escapeHtml(preview);
        const thinkingMsg = await ctx.reply(`🧠 <i>${escaped}</i>`, {
          parse_mode: "HTML",
        });
        state.toolMessages.push(thinkingMsg);
      } else if (statusType === "tool") {
        const toolMsg = await ctx.reply(content, { parse_mode: "HTML" });
        state.toolMessages.push(toolMsg);
      } else if (statusType === "text" && segmentId !== undefined) {
        state.segmentText.set(segmentId, content);
        await upsertPreview(getCombinedText(), false);
      } else if (statusType === "segment_end" && segmentId !== undefined) {
        if (content) state.segmentText.set(segmentId, content);
        await upsertPreview(getCombinedText(), true);
      } else if (statusType === "done") {
        await finalizePreview();

        // Delete transient tool status messages after completion.
        for (const toolMsg of state.toolMessages) {
          try {
            await ctx.api.deleteMessage(toolMsg.chat.id, toolMsg.message_id);
          } catch (error) {
            console.debug("Failed to delete tool message:", error);
          }
        }
      }
    } catch (error) {
      console.error("Status callback error:", error);
    }
  };
}
