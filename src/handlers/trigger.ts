/**
 * HTTP trigger endpoint.
 *
 * Lets an external caller (e.g. systemd ExecStopPost, cron) POST a prompt
 * that the bot processes as if the first allowed user had sent it via
 * Telegram. The full handler chain runs (rate limit, audit log, streaming)
 * and the user sees the conversation in their normal Telegram DM.
 *
 * Security: bound to TRIGGER_HOST (default 127.0.0.1), gated by
 * X-Trigger-Secret header against TRIGGER_SECRET env var. Disabled when
 * TRIGGER_SECRET is empty.
 */

import type { Bot } from "grammy";
import {
  ALLOWED_USERS,
  TRIGGER_ENABLED,
  TRIGGER_HOST,
  TRIGGER_PORT,
  TRIGGER_SECRET,
} from "../config";

interface TriggerBody {
  prompt?: string;
  chat_id?: number;
}

export function startTriggerServer(bot: Bot): { stop: () => void } | null {
  if (!TRIGGER_ENABLED) {
    console.log("HTTP trigger disabled (TRIGGER_SECRET unset)");
    return null;
  }

  if (ALLOWED_USERS.length === 0) {
    console.warn("HTTP trigger requested but no ALLOWED_USERS — skipping");
    return null;
  }

  const defaultUserId = ALLOWED_USERS[0];

  const server = Bun.serve({
    hostname: TRIGGER_HOST,
    port: TRIGGER_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/healthz") {
        return new Response("ok\n", { status: 200 });
      }

      if (req.method !== "POST" || url.pathname !== "/trigger") {
        return new Response("not found\n", { status: 404 });
      }

      const provided = req.headers.get("x-trigger-secret") || "";
      if (provided !== TRIGGER_SECRET) {
        return new Response("forbidden\n", { status: 403 });
      }

      let body: TriggerBody;
      try {
        body = (await req.json()) as TriggerBody;
      } catch {
        return new Response("invalid json\n", { status: 400 });
      }

      const prompt = (body.prompt || "").toString().trim();
      if (!prompt) {
        return new Response("missing prompt\n", { status: 400 });
      }

      const chatId = body.chat_id ?? defaultUserId;
      const userId = defaultUserId;

      const update = {
        update_id: Date.now() & 0x7fffffff,
        message: {
          message_id: -Math.floor(Math.random() * 1_000_000),
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: "private" as const },
          from: {
            id: userId,
            is_bot: false,
            first_name: "trigger",
            username: "trigger",
          },
          text: prompt,
        },
      };

      // Fire-and-forget: handlers stream replies to Telegram themselves.
      bot.handleUpdate(update as any).catch((err) => {
        console.error("Trigger handleUpdate failed:", err);
      });

      return new Response(JSON.stringify({ accepted: true }) + "\n", {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    },
  });

  console.log(
    `HTTP trigger listening on http://${TRIGGER_HOST}:${TRIGGER_PORT}/trigger`
  );

  return {
    stop: () => {
      server.stop(true);
    },
  };
}
