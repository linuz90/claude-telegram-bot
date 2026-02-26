/**
 * MCP Servers Configuration for Claude Telegram Bot.
 *
 * Copy this file and customize for your setup.
 * Each MCP server gives Claude access to external tools/data.
 *
 * Format matches Claude's MCP config schema.
 * See: https://docs.anthropic.com/en/docs/build-with-claude/mcp
 */

import { homedir } from "os";
import { dirname } from "path";

const HOME = homedir();
const REPO_ROOT = dirname(import.meta.path);

export const MCP_SERVERS: Record<
  string,
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> }
> = {
  // Ask User - present options as Telegram inline keyboard buttons
  "ask-user": {
    command: "bun",
    args: ["run", `${REPO_ROOT}/ask_user_mcp/server.ts`],
  },

  // Screenshot - take screenshots and send them to Telegram (macOS only)
  // Requires screen recording permissions in System Settings
  screenshot: {
    command: "bun",
    args: ["run", `${REPO_ROOT}/screenshot_mcp/server.ts`],
  },

  // Example: Typefully - draft and schedule social posts
  // Docs: https://support.typefully.com/en/articles/13128440-typefully-mcp-server
  // "typefully": {
  //   type: "http",
  //   url: `https://mcp.typefully.com/mcp?TYPEFULLY_API_KEY=${process.env.TYPEFULLY_API_KEY || ""}`
  // },

  // Example: Things 3 task manager (macOS)
  // Requires: https://github.com/hald/things-mcp
  // "things": {
  //   command: "uv",
  //   args: ["--directory", `${HOME}/Dev/things-mcp`, "run", "things_server.py"]
  // },
};
