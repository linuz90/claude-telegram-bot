/**
 * Shared media group handling for Claude Telegram Bot.
 *
 * Provides a generic buffer for handling Telegram media groups (albums)
 * with configurable processing callbacks.
 */

import type { Context } from "grammy";
import type { Message } from "grammy/types";
import type { PendingMediaGroup } from "../types";
import { MEDIA_GROUP_TIMEOUT } from "../config";
import { rateLimiter } from "../security";
import { auditLogRateLimit } from "../utils";
import { getSession } from "../ext/session-manager";

/**
 * Configuration for a media group handler.
 */
export interface MediaGroupConfig {
  /** Emoji for status messages (e.g., "📷" or "📄") */
  emoji: string;
  /** Label for items (e.g., "photo" or "document") */
  itemLabel: string;
  /** Plural label for items (e.g., "photos" or "documents") */
  itemLabelPlural: string;
}

/**
 * Callback to process a completed media group.
 */
export type ProcessGroupCallback = (
  ctx: Context,
  items: string[],
  caption: string | undefined,
  userId: number,
  username: string,
  chatId: number
) => Promise<void>;

/**
 * Creates a media group buffer with the specified configuration.
 *
 * Returns functions for adding items and processing groups.
 */
export function createMediaGroupBuffer(config: MediaGroupConfig) {
  const pendingGroups = new Map<string, PendingMediaGroup>();

  /**
   * Process a completed media group.
   */
  async function processGroup(
    groupId: string,
    processCallback: ProcessGroupCallback
  ): Promise<void> {
    const group = pendingGroups.get(groupId);
    if (!group) return;

    pendingGroups.delete(groupId);

    const userId = group.ctx.from?.id;
    const username = group.ctx.from?.username || "unknown";
    const chatId = group.ctx.chat?.id;

    if (!userId || !chatId) return;

    console.log(
      `Processing ${group.items.length} ${config.itemLabelPlural} from @${username}`
    );

    // Update status message
    if (group.statusMsg) {
      try {
        await group.ctx.api.editMessageText(
          group.statusMsg.chat.id,
          group.statusMsg.message_id,
          `${config.emoji} Processing ${group.items.length} ${config.itemLabelPlural}...`
        );
      } catch (error) {
        console.debug("Failed to update status message:", error);
      }
    }

    await processCallback(
      group.ctx,
      group.items,
      group.caption,
      userId,
      username,
      chatId
    );

    // Delete status message
    if (group.statusMsg) {
      try {
        await group.ctx.api.deleteMessage(
          group.statusMsg.chat.id,
          group.statusMsg.message_id
        );
      } catch (error) {
        console.debug("Failed to delete status message:", error);
      }
    }
  }

  /**
   * Add an item to a media group buffer.
   *
   * @returns true if the item was added successfully, false if rate limited
   */
  async function addToGroup(
    mediaGroupId: string,
    itemPath: string,
    ctx: Context,
    userId: number,
    username: string,
    processCallback: ProcessGroupCallback
  ): Promise<boolean> {
    if (!pendingGroups.has(mediaGroupId)) {
      // Rate limit on first item only
      const [allowed, retryAfter] = rateLimiter.check(userId);
      if (!allowed) {
        await auditLogRateLimit(userId, username, retryAfter!);
        await ctx.reply(
          `⏳ Rate limited. Please wait ${retryAfter!.toFixed(1)} seconds.`
        );
        return false;
      }

      // Create new group
      console.log(`Receiving ${config.itemLabel} album from @${username}`);
      const statusMsg = await ctx.reply(
        `${config.emoji} Receiving ${config.itemLabelPlural}...`
      );

      pendingGroups.set(mediaGroupId, {
        items: [itemPath],
        ctx,
        caption: ctx.message?.caption,
        statusMsg,
        timeout: setTimeout(
          () => processGroup(mediaGroupId, processCallback),
          MEDIA_GROUP_TIMEOUT
        ),
      });
    } else {
      // Add to existing group
      const group = pendingGroups.get(mediaGroupId)!;
      group.items.push(itemPath);

      // Update caption if this message has one
      if (ctx.message?.caption && !group.caption) {
        group.caption = ctx.message.caption;
      }

      // Reset timeout
      clearTimeout(group.timeout);
      group.timeout = setTimeout(
        () => processGroup(mediaGroupId, processCallback),
        MEDIA_GROUP_TIMEOUT
      );
    }

    return true;
  }

  return {
    addToGroup,
    processGroup,
    pendingGroups,
  };
}

/**
 * Shared error handler for media processing.
 *
 * Cleans up tool messages and sends appropriate error response.
 */
export async function handleProcessingError(
  ctx: Context,
  error: unknown,
  toolMessages: Message[]
): Promise<void> {
  const session = getSession(ctx);
  console.error("Error processing media:", error);

  // Clean up tool messages
  for (const toolMsg of toolMessages) {
    try {
      await ctx.api.deleteMessage(toolMsg.chat.id, toolMsg.message_id);
    } catch (cleanupError) {
      console.debug("Failed to delete tool message:", cleanupError);
    }
  }

  // Send error message
  const errorStr = String(error);
  if (errorStr.includes("abort") || errorStr.includes("cancel")) {
    // Only show "Query stopped" if it was an explicit stop, not an interrupt from a new message
    const wasInterrupt = session.consumeInterruptFlag();
    if (!wasInterrupt) {
      await ctx.reply("🛑 Query stopped.");
    }
  } else {
    await ctx.reply(`❌ Error: ${errorStr.slice(0, 200)}`);
  }
}
