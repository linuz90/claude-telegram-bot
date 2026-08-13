# Security model

This bot runs a Claude Code agent with **all permission prompts bypassed**
(`permissionMode: "bypassPermissions"` in `src/session.ts`). Whoever can send it
a Telegram message can make it read, write and execute anything the process can
reach.

That is deliberate. A phone is a bad place to answer permission prompts, and a
template cannot know which tools your agent needs. It does mean the perimeter is
the Telegram allowlist, and everything inside it is trusted.

## What is enforced

| Layer | Where | What it stops |
|---|---|---|
| User allowlist | `isAuthorized()`, called by every handler | Anyone whose Telegram ID is not in `TELEGRAM_ALLOWED_USERS` |
| Rate limiting | `rateLimiter.check()`, token bucket per user | Runaway loops and cost blowouts, not misuse |
| Audit log | `$STATE_DIR/claude-telegram-audit.log` | Nothing. It records, after the fact |
| Container | `deployment/Dockerfile` | Filesystem access outside `/app`; runs as non-root `bun` |

Only the first is a real access control on who may use the bot. The container is
the boundary on what it can reach, and the bot is only supported inside one.

## What is not enforced

**Nothing inside the container.** The agent's working directory holds its
instructions, its skills and its state, and `bypassPermissions` means every tool
call goes through without a check. There is no path allowlist and no command
filter; the template ships neither, because a half-wired one reads like
protection and is not.

Upstream had both, called from the streaming loop. That loop observes messages
*after* the model has emitted them, so it could log a dangerous call but never
stop one. Both were removed rather than left in place.

**`canUseTool` never fires.** Under `bypassPermissions` the SDK skips the
permission callback entirely. Wiring one up looks like protection and is not.

## Tightening

Three mechanisms actually work. Pick by how much you trust the agent.

### 1. `disallowedTools`

The bluntest and most reliable. Add it to the options in `src/session.ts`:

```ts
const options: Options = {
  // ...
  disallowedTools: ["Bash", "WebFetch"],
};
```

Denied tools are removed before the model sees them, so there is nothing to
argue with. Use this when your agent has a known, narrow toolset — a Notion
agent that never needs a shell, for example.

### 2. `PreToolUse` hooks

For per-call decisions: inspect the arguments and exit 2 to block. Because
`session.ts` sets `settingSources: ["user", "project"]`, hooks are read from
`~/.claude/settings.json` and from `.claude/settings.json` in the project scope.

Project scope resolves relative to `cwd`, which is `/app/agent` — not `/app`
where the code lives. So the hook belongs in `agent/.claude/settings.json`,
which the Dockerfile copies to `/app/agent/.claude/settings.json`.

Verify this with a hook that logs before relying on one that blocks. A hook in
the wrong place fails silently, which looks exactly like a hook that decided to
allow the call.

This is where path or command checking belongs if a use case needs it.

### 3. The container

The cheapest real boundary. Mount only what the agent needs, and mount reference
material read-only:

```yaml
    volumes:
      - ${STATE_PATH:-../data}:/app/agent/data
      - ../reference:/reference:ro
```

The image already runs as non-root and omits `git`. Only `data/` is mounted; the
instructions and skills above it are baked in, so edits to them do not outlive a
deploy.

## Building an agent on this template

Restrictions belong to the agent, not the template. A reasonable order:

1. Decide the toolset, then set `disallowedTools` to everything outside it.
2. Mount nothing you would not want overwritten.
3. Add `PreToolUse` hooks only for the cases the first two cannot express.
4. Keep the audit log somewhere you will actually read it.

Nothing on that list is a prompt. Instructing an agent not to do something is
worth doing, but it is not a control.
