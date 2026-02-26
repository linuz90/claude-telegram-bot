#!/usr/bin/env bun
/**
 * Screenshot MCP Server - Takes screenshots and sends them to Telegram.
 *
 * When Claude calls take_screenshot(), this server:
 * 1. Captures a screenshot using macOS screencapture
 * 2. Saves it to a temp file
 * 3. Writes metadata for the Telegram bot to pick up
 * 4. The bot sends the screenshot to the user
 *
 * Uses the official MCP TypeScript SDK for proper protocol compliance.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";
import { existsSync } from "fs";

// Create the MCP server
const server = new Server(
  {
    name: "screenshot",
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
        name: "take_screenshot",
        description:
          "Take a screenshot of the entire screen or a specific window and send it to the user via Telegram. The screenshot will be automatically sent to the chat.",
        inputSchema: {
          type: "object" as const,
          properties: {
            window: {
              type: "boolean",
              description:
                "If true, allows interactive window selection. If false (default), captures entire screen.",
              default: false,
            },
            description: {
              type: "string",
              description:
                "Optional description or caption for the screenshot (e.g., 'Here is the error message')",
            },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "take_screenshot") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as {
    window?: boolean;
    description?: string;
  };

  const windowMode = args.window || false;
  const description = args.description || "";

  try {
    // Generate unique filename
    const timestamp = Date.now();
    const screenshotPath = `/tmp/telegram-bot/screenshot_${timestamp}.png`;

    // Take screenshot using macOS screencapture
    // -x: no sound
    // -C: capture cursor
    // -w: window mode (interactive selection)
    const captureArgs = windowMode
      ? ["-x", "-C", "-w", screenshotPath]
      : ["-x", screenshotPath];

    execSync(`screencapture ${captureArgs.join(" ")}`, {
      timeout: 10000,
    });

    // Verify screenshot was created
    if (!existsSync(screenshotPath)) {
      throw new Error("Screenshot file was not created");
    }

    // Get chat context from environment
    const chatId = process.env.TELEGRAM_CHAT_ID || "";

    // Write metadata file for the bot to pick up
    const metadataPath = `/tmp/telegram-bot/screenshot_${timestamp}.json`;
    const metadata = {
      type: "screenshot",
      file_path: screenshotPath,
      chat_id: chatId,
      description: description,
      timestamp: new Date().toISOString(),
    };

    await Bun.write(metadataPath, JSON.stringify(metadata, null, 2));

    const resultMessage = description
      ? `Screenshot captured and will be sent with description: "${description}"`
      : "Screenshot captured and will be sent to the user";

    return {
      content: [
        {
          type: "text" as const,
          text: resultMessage,
        },
      ],
    };
  } catch (error) {
    const errorMsg = String(error);
    console.error("Screenshot error:", errorMsg);

    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to take screenshot: ${errorMsg}`,
        },
      ],
      isError: true,
    };
  }
});

// Run the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Screenshot MCP server running on stdio");
}

main().catch(console.error);
