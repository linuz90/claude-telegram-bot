/**
 * Video handler for Claude Telegram Bot.
 *
 * Downloads video files and passes them to video-processing skill for transcription.
 */

import type { Context } from "grammy";
import { getSession } from "../ext/session-manager";
import { ALLOWED_USERS, TEMP_DIR } from "../config";
import { isAuthorized, rateLimiter } from "../security";
import { auditLog, auditLogRateLimit, startTypingIndicator } from "../utils";
import { StreamingState, createStatusCallback } from "./streaming";
import { handleProcessingError } from "./media-group";

// Max video size (50MB - reasonable for short clips/voice memos)
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

/**
 * Download a video and return the local path.
 */
async function downloadVideo(ctx: Context): Promise<string> {
  const video = ctx.message?.video || ctx.message?.video_note;
  if (!video) {
    throw new Error("No video in message");
  }

  const file = await ctx.getFile();
  const timestamp = Date.now();

  // Use mp4 extension for regular videos, mp4 for video notes too
  const extension = ctx.message?.video_note ? "mp4" : "mp4";
  const videoPath = `${TEMP_DIR}/video_${timestamp}.${extension}`;

  // Download
  const response = await fetch(
    `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`
  );
  const buffer = await response.arrayBuffer();
  await Bun.write(videoPath, buffer);

  return videoPath;
}

/**
 * Handle incoming video messages.
 */
export async function handleVideo(ctx: Context): Promise<void> {
  const session = getSession(ctx);
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";
  const chatId = ctx.chat?.id;
  const video = ctx.message?.video || ctx.message?.video_note;
  const caption = ctx.message?.caption;

  if (!userId || !chatId || !video) {
    return;
  }

  // 1. Authorization check
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }

  // 2. Check file size
  if (video.file_size && video.file_size > MAX_VIDEO_SIZE) {
    await ctx.reply(
      `❌ Video too large. Maximum size is ${MAX_VIDEO_SIZE / 1024 / 1024}MB.`
    );
    return;
  }

  // 3. Rate limit check
  const [allowed, retryAfter] = rateLimiter.check(userId);
  if (!allowed) {
    await auditLogRateLimit(userId, username, retryAfter!);
    await ctx.reply(
      `⏳ Rate limited. Please wait ${retryAfter!.toFixed(1)} seconds.`
    );
    return;
  }

  console.log(`Received video from @${username}`);

  // 4. Download video
  let videoPath: string;
  const statusMsg = await ctx.reply("📹 Downloading video...");

  try {
    videoPath = await downloadVideo(ctx);
  } catch (error) {
    console.error("Failed to download video:", error);
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      "❌ Failed to download video."
    );
    return;
  }

  // 5. Process video
  const stopProcessing = session.startProcessing();
  const typing = startTypingIndicator(ctx);

  try {
    // Update status
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      "📹 Processing video..."
    );

    // Build prompt with video path
    const prompt = caption
      ? `Here's a video file at path: ${videoPath}\n\nUser says: ${caption}`
      : `I've received a video file at path: ${videoPath}\n\nPlease transcribe it for me.`;

    // Set conversation title (if new session)
    if (!session.isActive) {
      const rawTitle = caption || "[Video]";
      const title =
        rawTitle.length > 50 ? rawTitle.slice(0, 47) + "..." : rawTitle;
      session.conversationTitle = title;
    }

    // Create streaming state
    const state = new StreamingState();
    const statusCallback = createStatusCallback(ctx, state);

    const response = await session.sendMessageStreaming(
      prompt,
      username,
      userId,
      statusCallback,
      chatId,
      ctx
    );

    await auditLog(userId, username, "VIDEO", caption || "[video]", response);

    // Delete status message
    try {
      await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id);
    } catch {
      // Ignore deletion errors
    }
  } catch (error) {
    console.error("Video processing error:", error);

    // Delete status message on error
    try {
      await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id);
    } catch {
      // Ignore
    }

    await handleProcessingError(ctx, error, []);
  } finally {
    stopProcessing();
    typing.stop();

    // Note: We don't delete the video file immediately because video-processing
    // skill needs to access it. The skill should handle cleanup, or we rely on
    // temp directory cleanup
  }
}
