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

Four mechanisms actually work. Pick by how much you trust the agent.

### 1. `permissions.deny` in `agent/.claude/settings.json`

Usually the right one, and the only one that lives with the agent instead of
with the template's code:

```json
{
  "permissions": {
    "deny": [
      "Bash(notion page delete *)",
      "Bash(curl *api.notion.com*)",
      "WebFetch"
    ]
  }
}
```

**Deny rules are evaluated before the permission mode is consulted**, so they
hold under `bypassPermissions`. That is worth stating plainly, because the mode
name suggests otherwise. In CLI 2.1.229 the tool-call check runs deny-on-tool,
then deny-on-content, then ask rules, and only reaches the mode as a fallback
for calls that matched nothing — at which point `bypassPermissions` returns
`allow`.

Rules from settings and rules from `disallowedTools` end up in the same set,
tagged with a different source (`projectSettings` versus `cliArg`). They are the
same mechanism.

This works because `src/session.ts` sets `settingSources: ["user", "project"]`
and `cwd` is `/app/agent`, so project scope resolves to
`/app/agent/.claude/settings.json` — which is `agent/.claude/settings.json` in
the repository. Verify a new rule set actually loads before trusting it; a
settings file in the wrong place fails silently.

### 2. `disallowedTools`

The same rules, passed from code instead. Add them to the options in
`src/session.ts`:

```ts
const options: Options = {
  // ...
  disallowedTools: ["Bash", "WebFetch"],
};
```

A bare tool name removes the tool before the model sees it, so there is nothing
to argue with. Prefer settings.json unless the restriction belongs to the
template rather than to one agent.

### 3. `PreToolUse` hooks

For per-call decisions: inspect the arguments and exit 2 to block. Because
`session.ts` sets `settingSources: ["user", "project"]`, hooks are read from
`~/.claude/settings.json` and from `.claude/settings.json` in the project scope.

Project scope resolves relative to `cwd`, which is `/app/agent` — not `/app`
where the code lives. So the hook belongs in `agent/.claude/settings.json`,
which the Dockerfile copies to `/app/agent/.claude/settings.json`.

Verify this with a hook that logs before relying on one that blocks. A hook in
the wrong place fails silently, which looks exactly like a hook that decided to
allow the call.

Use a hook only for what a deny rule cannot express — a decision that depends on
the argument values rather than on the command shape.

### 4. The container

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

1. Write the deny rules in `agent/.claude/settings.json`. Start with what is
   irreversible outside the container, and with anything that routes around the
   tool you sanctioned — a raw `curl` to the same API is the usual hole.
2. Mount nothing you would not want overwritten.
3. Add `PreToolUse` hooks only for the cases a deny rule cannot express.
4. Keep the audit log somewhere you will actually read it.

Deny rules match the command shape, not its meaning. `Bash(notion page delete *)`
catches the direct form and not `sh -c "notion page delete x"` or
`true && notion page delete x`. That is a reason to also deny the routes around
the rule, not a reason to skip the rule.

Nothing on that list is a prompt. Instructing an agent not to do something is
worth doing, but it is not a control.
