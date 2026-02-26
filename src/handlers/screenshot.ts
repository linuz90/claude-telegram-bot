/**
 * Screenshot monitoring for Claude Telegram Bot.
 *
 * Monitors for screenshot files created by the screenshot MCP server
 * and sends them to Telegram.
 */

import type { Context } from "grammy";
import { readdirSync, readFileSync, unlinkSync } from "fs";
import { TEMP_DIR } from "../config";
import { InputFile } from "grammy";

interface ScreenshotMetadata {
  type: "screenshot";
  file_path: string;
  chat_id: string;
  description?: string;
  timestamp: string;
}

/**
 * Check for pending screenshots and send them to Telegram.
 * Returns true if any screenshots were sent.
 */
export async function checkPendingScreenshots(
  ctx: Context,
  chatId: number
): Promise<boolean> {
  try {
    const files = readdirSync(TEMP_DIR);
    const screenshotMetaFiles = files.filter(
      (f) => f.startsWith("screenshot_") && f.endsWith(".json")
    );

    if (screenshotMetaFiles.length === 0) {
      return false;
    }

    let sentAny = false;

    for (const metaFile of screenshotMetaFiles) {
      try {
        const metaPath = `${TEMP_DIR}/${metaFile}`;
        const metaContent = readFileSync(metaPath, "utf-8");
        const metadata: ScreenshotMetadata = JSON.parse(metaContent);

        // Only process screenshots for this chat
        if (String(metadata.chat_id) !== String(chatId)) {
          continue;
        }

        // Send the screenshot
        const caption = metadata.description || "Screenshot";
        await ctx.replyWithPhoto(new InputFile(metadata.file_path), {
          caption: caption,
        });

        sentAny = true;

        // Clean up
        try {
          unlinkSync(metaPath);
          unlinkSync(metadata.file_path);
        } catch (cleanupError) {
          console.debug("Failed to clean up screenshot files:", cleanupError);
        }
      } catch (error) {
        console.error(`Failed to process screenshot ${metaFile}:`, error);
      }
    }

    return sentAny;
  } catch (error) {
    console.debug("Error checking for screenshots:", error);
    return false;
  }
}
