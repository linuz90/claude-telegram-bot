#!/usr/bin/env bun
/**
 * Send File MCP Server - Sends files back to the user via Telegram.
 *
 * When Claude calls send_file(), this server writes a request file that the
 * Telegram bot monitors. The bot then sends the file using the appropriate
 * Telegram API method (video, photo, audio, or document).
 *
 * Fire-and-forget: Claude continues generating after calling this tool.
 *
 * Uses the official MCP TypeScript SDK for proper protocol compliance.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB Telegram limit

// Create the MCP server
const server = new Server(
  {
    name: "send-file",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "send_file",
        description:
          "Send a file to the user via Telegram. Supports images (png, jpg, gif, webp), videos (mp4, mov, avi, webm, mkv), audio (mp3, wav, ogg, flac, m4a), and any other file type. The file is delivered automatically based on its extension. This is fire-and-forget — you can continue generating after calling this tool.",
        inputSchema: {
          type: "object" as const,
          properties: {
            file_path: {
              type: "string",
              description:
                "Absolute path to the file to send (e.g. /tmp/preview.mp4)",
            },
            caption: {
              type: "string",
              description:
                "Optional caption to display with the file in Telegram",
            },
          },
          required: ["file_path"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "send_file") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as {
    file_path?: string;
    caption?: string;
  };

  const filePath = args.file_path || "";
  const caption = args.caption || "";

  if (!filePath) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Error: file_path is required",
        },
      ],
      isError: true,
    };
  }

  // Validate file exists and check size
  try {
    const file = Bun.file(filePath);
    const size = file.size;

    if (size === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: File not found or empty: ${filePath}`,
          },
        ],
        isError: true,
      };
    }

    if (size > MAX_FILE_SIZE) {
      const sizeMB = (size / (1024 * 1024)).toFixed(1);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: File too large (${sizeMB}MB). Telegram limit is 50MB.`,
          },
        ],
        isError: true,
      };
    }
  } catch {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: Cannot access file: ${filePath}`,
        },
      ],
      isError: true,
    };
  }

  // Get chat context from environment
  const chatId = process.env.TELEGRAM_CHAT_ID || "";
  if (!chatId) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Error: TELEGRAM_CHAT_ID not set. Cannot determine recipient.",
        },
      ],
      isError: true,
    };
  }

  // Write request file for the bot to pick up
  const requestUuid = crypto.randomUUID().slice(0, 8);
  const fileName = filePath.split("/").pop() || "file";

  const requestData = {
    request_id: requestUuid,
    file_path: filePath,
    caption,
    status: "pending",
    chat_id: chatId,
    created_at: new Date().toISOString(),
  };

  const requestFile = `/tmp/send-file-${requestUuid}.json`;
  await Bun.write(requestFile, JSON.stringify(requestData, null, 2));

  return {
    content: [
      {
        type: "text" as const,
        text: `File queued for delivery: ${fileName}`,
      },
    ],
  };
});

// Run the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Send File MCP server running on stdio");
}

main().catch(console.error);
