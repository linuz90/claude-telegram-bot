#!/usr/bin/env bun
/**
 * Ask User MCP Server - Presents options as Telegram inline keyboard buttons.
 *
 * When Claude calls ask_user(), this server writes a request file that the
 * Telegram bot monitors. The bot then displays inline keyboard buttons.
 * When the user clicks, their choice is injected back to Claude.
 *
 * Uses the official MCP TypeScript SDK for proper protocol compliance.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Create the MCP server
const server = new Server(
  {
    name: "ask-user",
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
        name: "ask_user",
        description:
          "Present options to the user as tappable inline buttons in Telegram. IMPORTANT: After calling this tool, STOP and wait. Do NOT add any text after calling this tool - the user will tap a button and their choice becomes their next message. Just call the tool and end your turn.",
        inputSchema: {
          type: "object" as const,
          properties: {
            question: {
              type: "string",
              description: "The question to ask the user",
            },
            options: {
              type: "array",
              items: { type: "string" },
              description:
                "List of options for the user to choose from (2-6 options recommended)",
              minItems: 2,
              maxItems: 10,
            },
          },
          required: ["question", "options"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "ask_user") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as {
    question?: string;
    options?: string[];
  };

  const question = args.question || "";
  const options = args.options || [];

  if (!question || !options || options.length < 2) {
    throw new Error("question and at least 2 options required");
  }

  // Generate request ID and get chat context from environment
  const requestUuid = crypto.randomUUID().slice(0, 8);
  const chatId = process.env.TELEGRAM_CHAT_ID || "";

  // Write request file for the bot to pick up
  const requestData = {
    request_id: requestUuid,
    question,
    options,
    status: "pending",
    chat_id: chatId,
    created_at: new Date().toISOString(),
  };

  const requestFile = `/tmp/ask-user-${requestUuid}.json`;
  await Bun.write(requestFile, JSON.stringify(requestData, null, 2));

  return {
    content: [
      {
        type: "text" as const,
        text: "[Buttons sent to user. STOP HERE - do not output any more text. Wait for user to tap a button.]",
      },
    ],
  };
});

// Run the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Ask User MCP server running on stdio");
}

main().catch(console.error);
