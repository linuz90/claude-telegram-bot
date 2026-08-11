/**
 * Tests for the PreToolUse permission gate.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

// config.ts exits the process without these, so they have to be set before the
// module graph is imported.
process.env.TELEGRAM_BOT_TOKEN ||= "test-token";
process.env.TELEGRAM_ALLOWED_USERS ||= "1";

const ALLOWED = "/tmp/permissions-test-allowed";
process.env.ALLOWED_PATHS ||= ALLOWED;
process.env.CLAUDE_WORKING_DIR ||= ALLOWED;

const { createPermissionHooks, DENY_RULES } = await import(
  "../src/permissions"
);

const hook = createPermissionHooks().PreToolUse[0]!.hooks[0]!;

async function decide(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<"allow" | "deny"> {
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: toolInput,
    } as never,
    "test-tool-use-id",
    { signal: new AbortController().signal }
  );
  const decision = (result as Record<string, any>)?.hookSpecificOutput
    ?.permissionDecision;
  return decision === "deny" ? "deny" : "allow";
}

describe("shell commands", () => {
  test("allows an ordinary command", async () => {
    expect(await decide("Bash", { command: "ls -la" })).toBe("allow");
  });

  test("denies recursive delete of root", async () => {
    expect(await decide("Bash", { command: "rm -rf /" })).toBe("deny");
  });

  test("denies privileged delete", async () => {
    expect(await decide("Bash", { command: "sudo rm -rf /etc" })).toBe("deny");
  });

  test("denies raw disk writes", async () => {
    expect(
      await decide("Bash", { command: "dd if=/dev/zero of=/dev/sda" })
    ).toBe("deny");
  });

  test("denies deleting outside the allowed paths", async () => {
    expect(await decide("Bash", { command: "rm /etc/hosts" })).toBe("deny");
  });
});

describe("credential files", () => {
  const secrets = [
    `${ALLOWED}/.env`,
    `${ALLOWED}/.env.production`,
    "/Users/someone/.ssh/id_rsa",
    "/Users/someone/.aws/credentials",
    `${ALLOWED}/server.pem`,
    `${ALLOWED}/secrets.yaml`,
  ];

  for (const path of secrets) {
    test(`denies reading ${path}`, async () => {
      expect(await decide("Read", { file_path: path })).toBe("deny");
    });
  }

  test("denies writing them too", async () => {
    expect(await decide("Write", { file_path: `${ALLOWED}/.env` })).toBe(
      "deny"
    );
  });
});

describe("path scoping", () => {
  test("allows a file inside the allowed paths", async () => {
    expect(await decide("Read", { file_path: `${ALLOWED}/notes.md` })).toBe(
      "allow"
    );
  });

  test("denies a file outside them", async () => {
    expect(await decide("Read", { file_path: "/etc/passwd" })).toBe("deny");
  });

  test("denies writing outside them", async () => {
    expect(await decide("Write", { file_path: "/etc/crontab" })).toBe("deny");
  });

  test("allows reads from the Telegram download dir", async () => {
    expect(
      await decide("Read", { file_path: "/tmp/telegram-bot/photo.jpg" })
    ).toBe("allow");
  });

  test("ignores calls with no file_path", async () => {
    expect(await decide("Read", {})).toBe("allow");
  });
});

describe("unrelated tools", () => {
  test("are not blocked by the gate", async () => {
    expect(await decide("WebSearch", { query: "weather" })).toBe("allow");
  });
});

describe("static deny rules", () => {
  test("are non-empty and scoped to a tool", () => {
    expect(DENY_RULES.length).toBeGreaterThan(0);
    for (const rule of DENY_RULES) {
      expect(rule).toMatch(/^[A-Za-z]+\(.+\)$/);
    }
  });
});
