/**
 * Audio handler for Claude Telegram Bot.
 *
 * Handles native Telegram audio messages and audio files sent as documents.
 * Transcribes using OpenAI (same as voice messages) then processes with Claude.
 */

import type { Context } from "grammy";
import { unlinkSync } from "fs";
import { session } from "../session";
import {
  ALLOWED_USERS,
  PRIMARY_LANGUAGE,
  TEMP_DIR,
  TRANSCRIPTION_PROMPT,
  TRANSCRIPTION_AVAILABLE,
  WHISPER_SERVICE_URL,
} from "../config";
import { responseLanguageInstruction, t } from "../i18n";
import { isAuthorized, rateLimiter } from "../security";
import {
  auditLog,
  auditLogError,
  auditLogRateLimit,
  transcribeVoice,
  startTypingIndicator,
} from "../utils";
import { saveLastMessage } from "../last-message";
import { StreamingState, createStatusCallback } from "./streaming";

// Supported audio file extensions
const AUDIO_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".ogg",
  ".wav",
  ".aac",
  ".flac",
  ".opus",
  ".wma",
];

/**
 * Check if a file is an audio file by extension or mime type.
 */
export function isAudioFile(fileName?: string, mimeType?: string): boolean {
  if (mimeType?.startsWith("audio/")) {
    return true;
  }
  if (fileName) {
    const ext = "." + (fileName.split(".").pop() || "").toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
  }
  return false;
}

async function transcribeWithLocalWhisper(filePath: string): Promise<string | null> {
  const whisper = Bun.which("whisper");
  if (!whisper) {
    return null;
  }

  const outDir = `${TEMP_DIR}/whisper_${Date.now()}`;
  await Bun.$`mkdir -p ${outDir}`.quiet();

  try {
    await Bun.$`${whisper} ${filePath} --language ${PRIMARY_LANGUAGE} --model base --output_format txt --output_dir ${outDir}`.quiet();
    const baseName = (filePath.split("/").pop() || "audio").replace(/\.[^.]+$/, "");
    const transcriptPath = `${outDir}/${baseName}.txt`;
    if (!(await Bun.file(transcriptPath).exists())) {
      return null;
    }
    const transcript = (await Bun.file(transcriptPath).text()).trim();
    return transcript || null;
  } catch (error) {
    console.error("Local Whisper transcription failed:", error);
    return null;
  }
}

async function transcribeWithWhisperService(
  filePath: string
): Promise<string | null> {
  if (!WHISPER_SERVICE_URL) {
    return null;
  }

  try {
    const form = new FormData();
    form.append("file", Bun.file(filePath));
    form.append("language", PRIMARY_LANGUAGE);
    form.append("prompt", TRANSCRIPTION_PROMPT);

    const response = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      console.error(
        `Whisper service failed: ${response.status} ${await response.text()}`
      );
      return null;
    }

    const payload = (await response.json()) as { text?: string };
    return payload.text?.trim() || null;
  } catch (error) {
    console.error("Whisper service request failed:", error);
    return null;
  }
}

async function transcribeAudio(filePath: string): Promise<string | null> {
  const serviceTranscript = await transcribeWithWhisperService(filePath);
  if (serviceTranscript) {
    return serviceTranscript;
  }

  const localTranscript = await transcribeWithLocalWhisper(filePath);
  if (localTranscript) {
    return localTranscript;
  }

  if (TRANSCRIPTION_AVAILABLE) {
    return transcribeVoice(filePath);
  }

  return null;
}

function buildVoicePrompt(rawTranscript: string, caption?: string): string {
  const captionBlock = caption ? `\n\nTelegram caption:\n${caption}` : "";

  return `[Telegram voice message]
ASR transcript:
${rawTranscript}${captionBlock}

Voice handling rules:
- Silently correct obvious speech-to-text errors before acting (misheard words, phonetic substitutions, brand/tool names).
- If a corrupted word changes the requested action, target, or source, ask one short clarification question instead of using tools or making assumptions.
- Do not reinterpret unclear voice input as a different task unless the transcript clearly supports it.
- ${responseLanguageInstruction()}

User message to answer:
${rawTranscript}`;
}

/**
 * Process an audio file: transcribe and send to Claude.
 */
export async function processAudioFile(
  ctx: Context,
  filePath: string,
  caption: string | undefined,
  userId: number,
  username: string,
  chatId: number
): Promise<void> {
  const stopProcessing = session.startProcessing();
  const typing = startTypingIndicator(ctx);

  try {
    const statusMsg = await ctx.reply(t.audioTranscribing);

    const transcript = await transcribeAudio(filePath);
    if (!transcript) {
      await auditLogError(
        userId,
        username,
        "Audio transcription unavailable: configure WHISPER_SERVICE_URL, install local whisper CLI, or configure OPENAI_API_KEY",
        "AUDIO"
      );
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        t.audioFailed
      );
      return;
    }

    const maxDisplay = 4000;
    const displayTranscript =
      transcript.length > maxDisplay
        ? transcript.slice(0, maxDisplay) + "..."
        : transcript;
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      t.audioPreview(displayTranscript)
    );

    const prompt = buildVoicePrompt(transcript, caption);

    session.lastMessage = prompt;
    saveLastMessage(prompt);

    // Set conversation title (if new session)
    if (!session.isActive) {
      session.conversationTitle =
        transcript.length > 50 ? transcript.slice(0, 47) + "..." : transcript;
    }

    // Create streaming state and callback
    const state = new StreamingState();
    const statusCallback = createStatusCallback(ctx, state);

    // Send to Claude
    const claudeResponse = await session.sendMessageStreaming(
      prompt,
      username,
      userId,
      statusCallback,
      chatId,
      ctx
    );

    // Audit log
    await auditLog(userId, username, "AUDIO", transcript, claudeResponse);
  } catch (error) {
    console.error("Error processing audio:", error);

    if (String(error).includes("abort") || String(error).includes("cancel")) {
      const wasInterrupt = session.consumeInterruptFlag();
      if (!wasInterrupt) {
        await ctx.reply(t.queryStopped);
      }
    } else {
      await ctx.reply(t.error(String(error).slice(0, 200)));
    }
  } finally {
    stopProcessing();
    typing.stop();

    // Clean up audio file
    try {
      unlinkSync(filePath);
    } catch (error) {
      console.debug("Failed to delete audio file:", error);
    }
  }
}

/**
 * Handle incoming native Telegram audio messages.
 */
export async function handleAudio(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";
  const chatId = ctx.chat?.id;
  const audio = ctx.message?.audio;

  if (!userId || !chatId || !audio) {
    return;
  }

  // 1. Authorization check
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(t.unauthorizedOwner);
    return;
  }

  // 2. Rate limit check
  const [allowed, retryAfter] = rateLimiter.check(userId);
  if (!allowed) {
    await auditLogRateLimit(userId, username, retryAfter!);
    await ctx.reply(
      t.rateLimited(retryAfter!.toFixed(1))
    );
    return;
  }

  console.log(`Received audio from @${username}`);

  // 3. Download audio file
  let audioPath: string;
  try {
    const file = await ctx.getFile();
    const timestamp = Date.now();
    const ext = audio.file_name?.split(".").pop() || "mp3";
    audioPath = `${TEMP_DIR}/audio_${timestamp}.${ext}`;

    const response = await fetch(
      `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await Bun.write(audioPath, buffer);
  } catch (error) {
    console.error("Failed to download audio:", error);
    await ctx.reply(t.downloadAudioFailed);
    return;
  }

  // 4. Process audio
  await processAudioFile(
    ctx,
    audioPath,
    ctx.message?.caption,
    userId,
    username,
    chatId
  );
}
