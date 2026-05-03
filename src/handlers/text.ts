/**
 * Text message handler for Claude Telegram Bot.
 */

import type { Context } from "grammy";
import { existsSync, readFileSync } from "fs";
import { session } from "../session";
import { ALLOWED_USERS, AUDIT_LOG_PATH } from "../config";
import {
  isRecentMessageIntent,
  responseLanguageInstruction,
  t,
} from "../i18n";
import { loadLastMessage, saveLastMessage } from "../last-message";
import { isAuthorized, rateLimiter } from "../security";
import {
  auditLog,
  auditLogRateLimit,
  checkInterrupt,
  startTypingIndicator,
} from "../utils";
import { StreamingState, createStatusCallback } from "./streaming";

function truncateContext(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength - 3) + "..." : text;
}

function getRecentAuditContext(limit = 4): string {
  if (!existsSync(AUDIT_LOG_PATH)) {
    return "";
  }

  try {
    const text = readFileSync(AUDIT_LOG_PATH, "utf-8");
    const entries = text
      .split("============================================================")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(-limit);

    return entries
      .map((entry) => {
        const content = entry.match(/^content: ([\s\S]*?)(?:\nresponse: |\n\w+: |$)/m)?.[1]?.trim();
        const response = entry.match(/^response: ([\s\S]*)$/m)?.[1]?.trim();
        const parts: string[] = [];
        if (content) parts.push(`User: ${truncateContext(content, 220)}`);
        if (response) parts.push(`Bot: ${truncateContext(response, 260)}`);
        return parts.join("\n");
      })
      .filter(Boolean)
      .join("\n---\n");
  } catch {
    return "";
  }
}

function buildClaudeTextMessage(message: string): string {
  if (!isRecentMessageIntent(message)) {
    return message;
  }

  const recentContext = getRecentAuditContext();
  const contextBlock = recentContext
    ? `\n\nRecent Telegram conversation context from audit log:\n${recentContext}`
    : "";

  return `${message}
${contextBlock}

[Telegram bot routing note: The user is asking about the latest Telegram message/conversation/transcript. Use the recent Telegram audit context above as the source of truth. If the audit context is insufficient, say exactly what is missing and ask for one short clarification. ${responseLanguageInstruction()}]`;
}

/**
 * Handle incoming text messages.
 */
export async function handleText(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";
  const chatId = ctx.chat?.id;
  let message = ctx.message?.text;

  if (!userId || !message || !chatId) {
    return;
  }

  const normalizedCommand = message.trim().match(/^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s+(.*))?$/);
  if (normalizedCommand?.[1]?.toLowerCase() === "llm") {
    const { handleLlm } = await import("./commands");
    const fakeCtx = {
      ...ctx,
      match: normalizedCommand[2] || "",
    } as Context & { match: string };
    await handleLlm(fakeCtx);
    return;
  }

  // 1. Authorization check
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorizedOwner);
    return;
  }

  // 2. Check for interrupt prefix
  message = await checkInterrupt(message);
  if (!message.trim()) {
    return;
  }

  if (message.trim() === ".") {
    const lastMessage = session.lastMessage || loadLastMessage();
    if (!lastMessage) {
      await ctx.reply(t.repeatMissing);
      return;
    }
    message = lastMessage;
    await ctx.reply(
      t.repeatRunning(`${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`)
    );
  }

  // 3. Rate limit check
  const [allowed, retryAfter] = rateLimiter.check(userId);
  if (!allowed) {
    await auditLogRateLimit(userId, username, retryAfter!);
    await ctx.reply(
      t.rateLimited(retryAfter!.toFixed(1))
    );
    return;
  }

  // 4. Store message for retry
  session.lastMessage = message;
  saveLastMessage(message);

  // 5. Set conversation title from first message (if new session)
  if (!session.isActive) {
    // Truncate title to ~50 chars
    const title =
      message.length > 50 ? message.slice(0, 47) + "..." : message;
    session.conversationTitle = title;
  }

  // 6. Mark processing started
  const stopProcessing = session.startProcessing();

  // 7. Start typing indicator
  const typing = startTypingIndicator(ctx);

  // 8. Create streaming state and callback
  let state = new StreamingState();
  let statusCallback = createStatusCallback(ctx, state);

  // 9. Send to Claude with retry logic for crashes
  const MAX_RETRIES = 1;
  const claudeMessage = buildClaudeTextMessage(message);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await session.sendMessageStreaming(
        claudeMessage,
        username,
        userId,
        statusCallback,
        chatId,
        ctx
      );

      // 10. Audit log
      await auditLog(userId, username, "TEXT", message, response);
      break; // Success - exit retry loop
    } catch (error) {
      const errorStr = String(error);
      const isProviderCrash = errorStr.includes("exited with code");

      // Clean up any partial messages from this attempt
      for (const toolMsg of state.toolMessages) {
        try {
          await ctx.api.deleteMessage(toolMsg.chat.id, toolMsg.message_id);
        } catch {
          // Ignore cleanup errors
        }
      }

      // Retry on Claude Code crash (not user cancellation)
      if (isProviderCrash && attempt < MAX_RETRIES) {
        console.log(
          `LLM provider crashed, retrying (attempt ${attempt + 2}/${MAX_RETRIES + 1})...`
        );
        await session.kill(); // Clear corrupted session
        await ctx.reply(t.providerRetry);
        // Reset state for retry
        state = new StreamingState();
        statusCallback = createStatusCallback(ctx, state);
        continue;
      }

      // Final attempt failed or non-retryable error
      console.error("Error processing message:", error);

      // Check if it was a cancellation
      if (errorStr.includes("abort") || errorStr.includes("cancel")) {
        // Only show "Query stopped" if it was an explicit stop, not an interrupt from a new message
        const wasInterrupt = session.consumeInterruptFlag();
        if (!wasInterrupt) {
          await ctx.reply(t.queryStopped);
        }
      } else {
        await ctx.reply(t.error(errorStr.slice(0, 200)));
      }
      break; // Exit loop after handling error
    }
  }

  // 11. Cleanup
  stopProcessing();
  typing.stop();
}
