/**
 * MCP servers for the Claude Telegram Bot.
 *
 * Loaded at startup by src/config.ts. This file is committed: the bot ships as
 * one container with one agent, so the server list is part of the build rather
 * than a per-machine setting. Secrets stay in .env and are read from
 * process.env here.
 *
 * Format matches Claude's MCP config schema.
 * See: https://docs.anthropic.com/en/docs/build-with-claude/mcp
 */

import { dirname } from "path";

// Absolute path to this directory - /app/mcp in the container. The servers
// below are spawned as child processes, so a relative path would resolve
// against the agent's cwd (/app/agent) instead.
const MCP_DIR = dirname(import.meta.path);

export const MCP_SERVERS: Record<
  string,
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> }
> = {
  // Present options as tappable Telegram inline buttons. The tap becomes the
  // user's next message.
  "ask-user": {
    command: "bun",
    args: ["run", `${MCP_DIR}/ask-user/server.ts`],
  },

  // Send files (images, video, audio, documents) back to the chat.
  "send-file": {
    command: "bun",
    args: ["run", `${MCP_DIR}/send-file/server.ts`],
  },

  // Add the agent's own servers below.
  //
  // HTTP:
  // "example": {
  //   type: "http",
  //   url: `https://mcp.example.com/mcp?key=${process.env.EXAMPLE_API_KEY || ""}`,
  // },
  //
  // stdio: the binary has to exist in the image - add it to
  // deployment/Dockerfile.
  // "example": {
  //   command: "example-mcp",
  //   args: ["--stdio"],
  // },
};
