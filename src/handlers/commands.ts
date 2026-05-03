/**
 * Command handlers for Claude Telegram Bot.
 *
 * /start, /new, /stop, /status, /resume, /restart
 */

import type { Context } from "grammy";
import { session } from "../session";
import {
  WORKING_DIR,
  ALLOWED_USERS,
  RESTART_FILE,
} from "../config";
import { loadLastMessage } from "../last-message";
import { dateLocale, t } from "../i18n";
import {
  describeLlmProvider,
  getActiveLlmProvider,
  getLlmProviderConfig,
  getLlmProviderIds,
  isLlmProvider,
  setActiveLlmProvider,
} from "../llm-provider";
import { isAuthorized } from "../security";

function getProviderAvailability(provider: string): [available: boolean, reason: string] {
  const config = getLlmProviderConfig(provider);
  if (config.type === "openai-chat") {
    const apiKeyEnv = config.apiKeyEnv || "OPENAI_API_KEY";
    return process.env[apiKeyEnv]
      ? [true, ""]
      : [false, t.llmApiKeyMissing(apiKeyEnv)];
  }
  if (config.type === "cli") {
    const found = config.command.includes("/") || Bun.which(config.command);
    return found
      ? [true, ""]
      : [false, t.llmCommandMissing(config.command)];
  }
  return [true, ""];
}

/**
 * /start - Show welcome message and status.
 */
export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorizedOwner);
    return;
  }

  const status = session.isActive ? "Active session" : "No active session";
  const workDir = WORKING_DIR;
  const llm = describeLlmProvider();

  await ctx.reply(
    `🤖 <b>Claude Telegram Bot</b>\n\n` +
      `Status: ${status}\n` +
      `LLM: <code>${llm}</code>\n` +
      `Working directory: <code>${workDir}</code>\n\n` +
      `<b>Commands:</b>\n` +
      `/new - Start fresh session\n` +
      `/stop - Stop current query\n` +
      `/status - Show detailed status\n` +
      `/llm - Show or switch LLM provider\n` +
      `/resume - Resume last session\n` +
      `/retry - Retry last message\n` +
      `/restart - Restart the bot\n\n` +
      `<b>Tips:</b>\n` +
      `• Prefix with <code>!</code> to interrupt current query\n` +
      `• Use "think" keyword for extended reasoning\n` +
      `• Send photos, voice, or documents`,
    { parse_mode: "HTML" }
  );
}

/**
 * /new - Start a fresh session.
 */
export async function handleNew(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorized);
    return;
  }

  // Stop any running query
  if (session.isRunning) {
    const result = await session.stop();
    if (result) {
      await Bun.sleep(100);
      session.clearStopRequested();
    }
  }

  // Clear session
  await session.kill();

  await ctx.reply(t.newDone);
}

/**
 * /stop - Stop the current query (silently).
 */
export async function handleStop(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorized);
    return;
  }

  if (session.isRunning) {
    const result = await session.stop();
    if (result) {
      // Wait for the abort to be processed, then clear stopRequested so next message can proceed
      await Bun.sleep(100);
      session.clearStopRequested();
    }
    // Silent stop - no message shown
  }
  // If nothing running, also stay silent
}

/**
 * /status - Show detailed status.
 */
export async function handleStatus(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorized);
    return;
  }

  const lines: string[] = [t.statusTitle];
  lines.push(`🧠 LLM: <code>${describeLlmProvider()}</code>`);

  // Session status
  if (session.isActive) {
    lines.push(`✅ Session: Active (${session.sessionId?.slice(0, 8)}...)`);
  } else {
    lines.push("⚪ Session: None");
  }

  // Query status
  if (session.isRunning) {
    const elapsed = session.queryStarted
      ? Math.floor((Date.now() - session.queryStarted.getTime()) / 1000)
      : 0;
    lines.push(`🔄 Query: Running (${elapsed}s)`);
    if (session.currentTool) {
      lines.push(`   └─ ${session.currentTool}`);
    }
  } else {
    lines.push("⚪ Query: Idle");
    if (session.lastTool) {
      lines.push(`   └─ Last: ${session.lastTool}`);
    }
  }

  // Last activity
  if (session.lastActivity) {
    const ago = Math.floor(
      (Date.now() - session.lastActivity.getTime()) / 1000
    );
    lines.push(`\n⏱️ Last activity: ${ago}s ago`);
  }

  // Usage stats
  if (session.lastUsage) {
    const usage = session.lastUsage;
    lines.push(
      `\n📈 Last query usage:`,
      `   Input: ${usage.input_tokens?.toLocaleString() || "?"} tokens`,
      `   Output: ${usage.output_tokens?.toLocaleString() || "?"} tokens`
    );
    if (usage.cache_read_input_tokens) {
      lines.push(
        `   Cache read: ${usage.cache_read_input_tokens.toLocaleString()}`
      );
    }
  }

  // Error status
  if (session.lastError) {
    const ago = session.lastErrorTime
      ? Math.floor((Date.now() - session.lastErrorTime.getTime()) / 1000)
      : "?";
    lines.push(`\n⚠️ Last error (${ago}s ago):`, `   ${session.lastError}`);
  }

  // Working directory
  lines.push(`\n📁 Working dir: <code>${WORKING_DIR}</code>`);

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

/**
 * /llm - Show or switch the active LLM provider.
 */
export async function handleLlm(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorized);
    return;
  }

  const match = String((ctx as Context & { match?: string }).match || "")
    .trim()
    .toLowerCase();

  if (!match || match === "status") {
    const providerLines = getLlmProviderIds()
      .map((id) => {
        const active = id === getActiveLlmProvider() ? "•" : "-";
        const [available, reason] = getProviderAvailability(id);
        const availability = available ? "" : ` (${reason})`;
        return `${active} <code>${id}</code> - ${describeLlmProvider(id)}${availability}`;
      })
      .join("\n");

    await ctx.reply(
      t.llmActive(getActiveLlmProvider(), describeLlmProvider(), providerLines),
      { parse_mode: "HTML" }
    );
    return;
  }

  if (!isLlmProvider(match)) {
    await ctx.reply(
      t.llmInvalid(getLlmProviderIds().join(", "))
    );
    return;
  }

  const [available, reason] = getProviderAvailability(match);
  if (!available) {
    await ctx.reply(t.llmUnavailable(match, reason));
    return;
  }

  if (session.isRunning) {
    await ctx.reply(t.llmBusy);
    return;
  }

  setActiveLlmProvider(match);
  await ctx.reply(
    t.llmChanged(match, describeLlmProvider(match)),
    { parse_mode: "HTML" }
  );
}

/**
 * /resume - Show list of sessions to resume with inline keyboard.
 */
export async function handleResume(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorized);
    return;
  }

  if (session.isActive) {
    await ctx.reply(t.resumeActive);
    return;
  }

  // Get saved sessions
  const sessions = session.getSessionList();

  if (sessions.length === 0) {
    await ctx.reply(t.resumeEmpty);
    return;
  }

  // Build inline keyboard with session list
  const buttons = sessions.map((s) => {
    // Format date: "18/01 10:30"
    const date = new Date(s.saved_at);
    const dateStr = date.toLocaleDateString(dateLocale(), {
      day: "2-digit",
      month: "2-digit",
    });
    const timeStr = date.toLocaleTimeString(dateLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Truncate title for button (max ~40 chars to fit)
    const titlePreview =
      s.title.length > 35 ? s.title.slice(0, 32) + "..." : s.title;

    return [
      {
        text: `📅 ${dateStr} ${timeStr} - "${titlePreview}"`,
        callback_data: `resume:${s.session_id}`,
      },
    ];
  });

  await ctx.reply(t.resumeTitle, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

/**
 * /restart - Restart the bot process.
 */
export async function handleRestart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorized);
    return;
  }

  const msg = await ctx.reply(t.restarting);

  // Save message info so we can update it after restart
  if (chatId && msg.message_id) {
    try {
      await Bun.write(
        RESTART_FILE,
        JSON.stringify({
          chat_id: chatId,
          message_id: msg.message_id,
          timestamp: Date.now(),
        })
      );
    } catch (e) {
      console.warn("Failed to save restart info:", e);
    }
  }

  // Give time for the message to send
  await Bun.sleep(500);

  // Exit - launchd will restart us
  process.exit(0);
}

/**
 * /retry - Retry the last message (resume session and re-send).
 */
export async function handleRetry(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorized);
    return;
  }

  // Check if there's a message to retry
  const lastMessage = session.lastMessage || loadLastMessage();
  if (!lastMessage) {
    await ctx.reply(t.retryMissing);
    return;
  }

  // Check if something is already running
  if (session.isRunning) {
    await ctx.reply(t.retryBusy);
    return;
  }

  const message = lastMessage;
  await ctx.reply(t.retrying(`${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`));

  // Simulate sending the message again by emitting a fake text message event
  // We do this by directly calling the text handler logic
  const { handleText } = await import("./text");

  // Create a modified context with the last message
  const fakeCtx = {
    ...ctx,
    message: {
      ...ctx.message,
      text: message,
    },
  } as Context;

  await handleText(fakeCtx);
}
