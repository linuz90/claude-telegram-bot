/**
 * Command handlers for the Telegram bot.
 *
 * /start, /new, /stop, /status, /policy, /model, /assistant, /resume, /restart
 */

import type { Context } from "grammy";
import { session } from "../session";
import {
  WORKING_DIR,
  ALLOWED_USERS,
  ALLOWED_PATHS,
  CLAUDE_ENABLE_CHROME,
  CODEX_SANDBOX_MODE,
  CODEX_APPROVAL_POLICY,
  CODEX_NETWORK_ACCESS_ENABLED,
  CODEX_WEB_SEARCH_MODE,
  CODEX_REASONING_EFFORT,
  RESTART_FILE,
} from "../config";
import { isAuthorized } from "../security";

/**
 * /start - Show welcome message and status.
 */
export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }

  const status = session.isActive ? "Active session" : "No active session";
  const workDir = WORKING_DIR;
  const assistantLabel =
    session.assistant === "codex" ? "Codex" : "Claude";

  await ctx.reply(
    `🤖 <b>AI Telegram Bot</b>\n\n` +
      `Assistant: ${assistantLabel}\n` +
      `Model: <code>${session.modelDisplay}</code>\n` +
      `Status: ${status}\n` +
      `Working directory: <code>${workDir}</code>\n\n` +
      `<b>Commands:</b>\n` +
      `/new - Start fresh session\n` +
      `/stop - Stop current query\n` +
      `/status - Show detailed status\n` +
      `/policy - Show runtime policy\n` +
      `/model - Switch assistant/model\n` +
      `/assistant - Alias for /model\n` +
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
    await ctx.reply("Unauthorized.");
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

  await ctx.reply("🆕 Session cleared. Next message starts fresh.");
}

/**
 * /stop - Stop the current query (silently).
 */
export async function handleStop(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
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
    await ctx.reply("Unauthorized.");
    return;
  }

  const lines: string[] = ["📊 <b>Bot Status</b>\n"];
  lines.push(`🤖 Assistant: ${session.assistant}`);
  lines.push(`🧠 Model: <code>${session.modelDisplay}</code>`);

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
 * /policy - Show runtime sandbox/approval/paths policy.
 */
export async function handlePolicy(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const lines: string[] = ["🛡️ <b>Runtime Policy</b>\n"];
  lines.push(`🤖 Assistant: <code>${session.assistant}</code>`);
  lines.push(`🧠 Model: <code>${session.modelDisplay}</code>`);
  lines.push(`📁 Working dir: <code>${WORKING_DIR}</code>`);
  lines.push("");
  lines.push("<b>Claude Runtime:</b>");
  lines.push(`• Chrome tools: <code>${CLAUDE_ENABLE_CHROME ? "enabled" : "disabled"}</code>`);
  lines.push(`• Default effort: <code>${session.claudeReasoningEffort}</code>`);
  lines.push("");
  lines.push("<b>Codex Runtime:</b>");
  lines.push(`• Sandbox: <code>${CODEX_SANDBOX_MODE}</code>`);
  lines.push(`• Approval: <code>${CODEX_APPROVAL_POLICY}</code>`);
  lines.push(
    `• Network: <code>${CODEX_NETWORK_ACCESS_ENABLED ? "enabled" : "disabled"}</code>`
  );
  lines.push(`• Web search: <code>${CODEX_WEB_SEARCH_MODE}</code>`);
  lines.push(`• Default effort: <code>${CODEX_REASONING_EFFORT}</code>`);
  lines.push("");
  lines.push("<b>Allowed Paths:</b>");
  for (const path of ALLOWED_PATHS) {
    lines.push(`• <code>${path}</code>`);
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

/**
 * /model - Switch active assistant/model at runtime.
 *
 * Canonical examples:
 * - /model opus 4.6
 * - /model sonnet 4.5
 * - /model codex 5.3 low
 * - /model codex 5.3 medium
 * - /model codex 5.3 high
 */
export async function handleModel(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const rawText = ctx.message?.text || "";

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const [, ...parts] = rawText.trim().split(/\s+/);
  const modelArg = parts.join(" ").trim();

  if (!modelArg) {
    await ctx.reply(
      `Current: <b>${session.assistant}</b> / <code>${session.modelDisplay}</code>\n\n` +
        `Usage:\n` +
        `/model opus 4.6\n` +
        `/model sonnet 4.5\n` +
        `/model codex 5.3 low\n` +
        `/model codex 5.3 medium\n` +
        `/model codex 5.3 high`,
      { parse_mode: "HTML" }
    );
    return;
  }

  if (session.isRunning) {
    const result = await session.stop();
    if (result) {
      await Bun.sleep(100);
      session.clearStopRequested();
    }
  }

  const [ok, message] = session.setModel(modelArg);
  if (!ok) {
    await ctx.reply(`❌ ${message}`);
    return;
  }
  await ctx.reply(`✅ ${message}`);
}

/**
 * /assistant - Alias for /model to keep command naming intuitive.
 */
export async function handleAssistant(ctx: Context): Promise<void> {
  await handleModel(ctx);
}

/**
 * /resume - Show list of sessions to resume with inline keyboard.
 */
export async function handleResume(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  if (session.isActive) {
    await ctx.reply("Sessione già attiva. Usa /new per iniziare da capo.");
    return;
  }

  // Get saved sessions
  const sessions = session.getSessionList();

  if (sessions.length === 0) {
    await ctx.reply("❌ Nessuna sessione salvata.");
    return;
  }

  // Build inline keyboard with session list
  const buttons = sessions.map((s) => {
    // Format date: "18/01 10:30"
    const date = new Date(s.saved_at);
    const dateStr = date.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
    });
    const timeStr = date.toLocaleTimeString("it-IT", {
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

  await ctx.reply("📋 <b>Sessioni salvate</b>\n\nSeleziona una sessione da riprendere:", {
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
    await ctx.reply("Unauthorized.");
    return;
  }

  const msg = await ctx.reply("🔄 Restarting bot...");

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
    await ctx.reply("Unauthorized.");
    return;
  }

  // Check if there's a message to retry
  if (!session.lastMessage) {
    await ctx.reply("❌ No message to retry.");
    return;
  }

  // Check if something is already running
  if (session.isRunning) {
    await ctx.reply("⏳ A query is already running. Use /stop first.");
    return;
  }

  const message = session.lastMessage;
  await ctx.reply(`🔄 Retrying: "${message.slice(0, 50)}${message.length > 50 ? "..." : ""}"`);

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
