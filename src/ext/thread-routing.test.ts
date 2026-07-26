import { describe, test, expect } from "bun:test";
import type { Context } from "grammy";
import {
  currentThreadId,
  threadContextMiddleware,
  shouldInjectThreadId,
  installThreadApiTransformer,
  THREAD_AWARE_METHODS,
} from "./thread-routing";

function fakeCtx(threadId?: number): Context {
  return { msg: threadId === undefined ? {} : { message_thread_id: threadId } } as unknown as Context;
}

describe("threadContextMiddleware / currentThreadId", () => {
  test("no thread on ctx -> currentThreadId() is undefined inside next()", async () => {
    let seen: number | undefined = -1 as unknown as undefined;
    await threadContextMiddleware(fakeCtx(), async () => {
      seen = currentThreadId();
    });
    expect(seen).toBeUndefined();
  });

  test("thread on ctx -> currentThreadId() reflects it inside next()", async () => {
    let seen: number | undefined;
    await threadContextMiddleware(fakeCtx(45), async () => {
      seen = currentThreadId();
    });
    expect(seen).toBe(45);
  });

  test("currentThreadId() is unset again after the middleware call completes", async () => {
    await threadContextMiddleware(fakeCtx(45), async () => {});
    expect(currentThreadId()).toBeUndefined();
  });

  test("concurrent updates on different threads don't leak into each other", async () => {
    // This is the whole point of AsyncLocalStorage over a plain module
    // variable: two "in-flight" updates processed concurrently (as grammy's
    // runner does for commands/callback queries) must each see their own
    // thread id, not whichever one happened to run last.
    const seenA: (number | undefined)[] = [];
    const seenB: (number | undefined)[] = [];

    async function process(threadId: number | undefined, sink: (number | undefined)[]) {
      await threadContextMiddleware(fakeCtx(threadId), async () => {
        sink.push(currentThreadId());
        await Bun.sleep(20); // yield, interleave with the other "request"
        sink.push(currentThreadId());
      });
    }

    await Promise.all([process(1, seenA), process(2, seenB)]);

    expect(seenA).toEqual([1, 1]);
    expect(seenB).toEqual([2, 2]);
  });
});

describe("shouldInjectThreadId", () => {
  test("true for a thread-aware method with chat_id and no existing message_thread_id", () => {
    expect(shouldInjectThreadId("sendMessage", { chat_id: 1, text: "hi" })).toBe(true);
  });

  test("false if message_thread_id is already present (never override an explicit value)", () => {
    expect(
      shouldInjectThreadId("sendMessage", { chat_id: 1, text: "hi", message_thread_id: 99 })
    ).toBe(false);
  });

  test("false without chat_id (method doesn't target a specific chat)", () => {
    expect(shouldInjectThreadId("sendMessage", { text: "hi" })).toBe(false);
  });

  test("false for a method outside the thread-aware set (e.g. editMessageText)", () => {
    expect(shouldInjectThreadId("editMessageText", { chat_id: 1, text: "hi" })).toBe(false);
  });

  test("every documented thread-aware method requires chat_id to trigger injection", () => {
    for (const method of THREAD_AWARE_METHODS) {
      expect(shouldInjectThreadId(method, { chat_id: 1 })).toBe(true);
    }
  });
});

describe("installThreadApiTransformer", () => {
  // Minimal fake Bot: only api.config.use is touched by
  // installThreadApiTransformer, so that's all the fake needs to provide.
  function fakeBot() {
    let transformer:
      | ((prev: any, method: string, payload: any, signal?: AbortSignal) => any)
      | undefined;
    const bot = {
      api: {
        config: {
          use: (t: typeof transformer) => {
            transformer = t;
          },
        },
      },
    };
    return { bot: bot as any, call: (method: string, payload: any) => transformer!(prevSpy, method, payload) };
  }

  let prevCalls: Array<{ method: string; payload: any }> = [];
  const prevSpy = async (method: string, payload: any) => {
    prevCalls.push({ method, payload });
    return { ok: true, result: {} };
  };

  test("injects message_thread_id when inside a threaded context", async () => {
    prevCalls = [];
    const { bot, call } = fakeBot();
    installThreadApiTransformer(bot);

    await threadContextMiddleware(fakeCtx(45), async () => {
      await call("sendMessage", { chat_id: 1, text: "hi" });
    });

    expect(prevCalls).toEqual([
      { method: "sendMessage", payload: { chat_id: 1, text: "hi", message_thread_id: 45 } },
    ]);
  });

  test("does not inject outside any threaded context (regular chat, no forum topic)", async () => {
    prevCalls = [];
    const { bot, call } = fakeBot();
    installThreadApiTransformer(bot);

    await threadContextMiddleware(fakeCtx(undefined), async () => {
      await call("sendMessage", { chat_id: 1, text: "hi" });
    });

    expect(prevCalls).toEqual([{ method: "sendMessage", payload: { chat_id: 1, text: "hi" } }]);
  });

  test("does not override an explicitly-set message_thread_id", async () => {
    prevCalls = [];
    const { bot, call } = fakeBot();
    installThreadApiTransformer(bot);

    await threadContextMiddleware(fakeCtx(45), async () => {
      await call("sendMessage", { chat_id: 1, text: "hi", message_thread_id: 7 });
    });

    expect(prevCalls[0]!.payload.message_thread_id).toBe(7);
  });

  test("leaves non-thread-aware methods untouched even inside a threaded context", async () => {
    prevCalls = [];
    const { bot, call } = fakeBot();
    installThreadApiTransformer(bot);

    await threadContextMiddleware(fakeCtx(45), async () => {
      await call("editMessageText", { chat_id: 1, message_id: 5, text: "hi" });
    });

    expect(prevCalls).toEqual([
      { method: "editMessageText", payload: { chat_id: 1, message_id: 5, text: "hi" } },
    ]);
  });
});
