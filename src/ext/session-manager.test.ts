import { describe, test, expect, beforeEach } from "bun:test";
import type { Context } from "grammy";
import { keyForCtx, getSession, _resetSessionsForTest } from "./session-manager";

// Minimal fake ctx: keyForCtx/getSession only ever read ctx.msg and ctx.chat,
// both plain property reads on the real Context class too, so a plain object
// cast is sufficient and keeps these tests free of any real grammY/Telegram setup.
function fakeCtx(chatId: number, threadId?: number): Context {
  return {
    chat: { id: chatId },
    msg: threadId === undefined ? {} : { message_thread_id: threadId },
  } as unknown as Context;
}

beforeEach(() => {
  _resetSessionsForTest();
});

describe("keyForCtx", () => {
  test("no thread id maps to the literal 'default' key", () => {
    expect(keyForCtx(fakeCtx(123))).toBe("default");
  });

  test("with a thread id, keys by chatId:threadId", () => {
    expect(keyForCtx(fakeCtx(123, 45))).toBe("123:45");
  });

  test("different threads in the same chat get different keys", () => {
    expect(keyForCtx(fakeCtx(123, 1))).not.toBe(keyForCtx(fakeCtx(123, 2)));
  });

  test("same chat+thread always yields the same key", () => {
    expect(keyForCtx(fakeCtx(123, 45))).toBe(keyForCtx(fakeCtx(123, 45)));
  });
});

describe("getSession", () => {
  test("returns the same instance for the same key", () => {
    const a = getSession(fakeCtx(123, 45));
    const b = getSession(fakeCtx(123, 45));
    expect(a).toBe(b);
  });

  test("returns different instances for different threads", () => {
    const a = getSession(fakeCtx(123, 1));
    const b = getSession(fakeCtx(123, 2));
    expect(a).not.toBe(b);
  });

  test("no-thread messages across different chats share the single 'default' instance", () => {
    // Matches the pre-existing single-singleton behavior for non-forum chats.
    const a = getSession(fakeCtx(111));
    const b = getSession(fakeCtx(222));
    expect(a).toBe(b);
  });
});
