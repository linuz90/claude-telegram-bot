# CLAUDE.md

Guidance for Claude Code when working on this repository.

Setup, configuration and deployment are in [README.md](README.md); the provider
and security models are in [docs/](docs/). This file covers only what you need to
change code here, and deliberately does not repeat them.

## Commands

```bash
bun run typecheck  # tsc --noEmit - the only thing that runs on the host
docker compose -f deployment/docker-compose.yml up -d --build
docker compose -f deployment/docker-compose.yml logs -f
```

The bot only runs in the container. `bun run start` and `bun run dev` still exist in `package.json` but assume `/app/agent` and `/app/agent/data`, so they will not work on a host.

## Architecture

A Telegram bot (~4,400 lines of TypeScript in `src/`) that lets you drive a Claude Code agent from your phone via text, voice, photos, documents and video. Built with Bun and grammY, deployed as a Docker container.

### Layout

| Path | In the image | Role |
|---|---|---|
| `src/`, `mcp/` | `/app` | the bot's own code |
| `agent/` | `/app/agent` | the agent's CLAUDE.md and skills, copied in at build time |
| — | `/app/agent/data` | volume: session file, audit log, downloads, `memory/` |

`/app/agent/data` is bind-mounted from the host and is the only thing that survives a redeploy. It also holds `CLAUDE_CONFIG_DIR`, so the CLI's conversation transcripts and its memory directory are on the volume too.

### Message Flow

```
Telegram message → Handler → Auth check → Rate limit → Claude session → Streaming response → Audit log
```

### Key Modules

- **`src/index.ts`** - Entry point, registers handlers, starts polling
- **`src/config.ts`** - Environment parsing, MCP loading, `STATE_DIR` paths
- **`src/provider.ts`** - LLM provider: endpoint, credential, model tiers, and the env handed to the child Claude Code process
- **`src/session.ts`** - `ClaudeSession` class wrapping Agent SDK V2 with streaming and session persistence
- **`src/security.ts`** - `RateLimiter` (token bucket) and `isAuthorized`. That is the whole file; there is no path or command filtering
- **`src/formatting.ts`** - Markdown→HTML conversion for Telegram, tool status emoji formatting
- **`src/utils.ts`** - Audit logging, voice transcription (OpenAI), typing indicators
- **`src/types.ts`** - Shared TypeScript types

### Handlers (`src/handlers/`)

Each message type has a dedicated async handler:
- **`commands.ts`** - `/start`, `/new`, `/stop`, `/status`, `/resume`, `/restart`, `/retry`
- **`text.ts`** - Text messages: auth, `checkInterrupt()` for the `!` prefix, rate limit, then the session
- **`voice.ts`** - Voice→text via OpenAI, then same flow as text
- **`audio.ts`** - Audio file transcription via OpenAI (mp3, m4a, ogg, wav, etc.), also handles audio sent as documents
- **`photo.ts`** - Image analysis with media group buffering (1s timeout for albums)
- **`document.ts`** - PDF extraction (pdftotext CLI), text files, archives, routes audio files to `audio.ts`
- **`video.ts`** - Video messages and video notes
- **`callback.ts`** - Inline keyboard button handling for ask_user MCP
- **`streaming.ts`** - Shared `StreamingState` and status callback factory

### Security

The agent runs under `bypassPermissions`. Do not add a `canUseTool` callback — it
never fires in that mode. See [docs/security.md](docs/security.md) before
touching anything in `src/security.ts` or the options block in `src/session.ts`.

### Runtime Files

All under `STATE_DIR` (`/app/agent/data`):

- `claude-telegram-session.json` - session persistence for `/resume`
- `telegram-bot/` - downloaded photos and documents
- `claude-telegram-audit.log` - audit log
- `memory/` - the agent's persistent notes

The two MCP servers hand off through `/tmp/ask-user-*.json` and
`/tmp/send-file-*.json`, hardcoded on both sides and independent of `STATE_DIR`.

## Patterns

**Adding a command**: Create handler in `commands.ts`, register in `index.ts` with `bot.command("name", handler)`

**Adding a message handler**: Create in `handlers/`, export from `index.ts`, register in `index.ts` with appropriate filter

**Streaming pattern**: All handlers use `createStatusCallback()` from `streaming.ts` and `session.sendMessageStreaming()` for live updates.

**Type checking**: Run `bun run typecheck` periodically while editing TypeScript files. Fix any type errors before committing.

**After code changes**: rebuild the container. There is no host run mode to test against.

**Adding agent instructions or skills**: they go in `agent/`, never in the repository root. The SDK resolves them relative to `cwd` (`/app/agent`), and the code lives in `/app`.

## Gotchas

**External binaries**: PDF extraction shells out to `pdftotext` and archives to `unzip`, rather than npm packages, to avoid bundling issues. Both are installed in `deployment/Dockerfile`. Any MCP server you add that needs a binary goes there too.

**Container paths are not configuration**: `CLAUDE_WORKING_DIR` and `STATE_DIR` are set in the Dockerfile and match the image layout. The defaults in `src/config.ts` mirror them so the code reads the same either way. Do not reintroduce host fallbacks like `homedir()` — that is what this fork removed.

**`STATE_DIR` sits inside `CLAUDE_WORKING_DIR`** on purpose. Move it out and the agent loses access to Telegram downloads and its own memory unless you add `additionalDirectories` back.

**`systemPrompt` must stay a preset object**: a plain string replaces Claude Code's entire system prompt instead of adding to it. Use `{ type: "preset", preset: "claude_code", append: "..." }`.

**The SDK's CLI is a ~290MB native binary**, not the `cli.js` it used to be. Bun
installs both the glibc and the musl build for the architecture, and the
Dockerfile deletes the musl one in the same layer as the install. Do not "tidy"
that away. It also means the image is architecture-specific: it is built for the
platform you build on.

**`.dockerignore` lives in the repository root**, not in `deployment/` next to the Dockerfile. Docker only reads it from the root of the build context.

**Two gitignored files**: `.env` and `deployment/docker-compose.yml`. Both have a committed `.example` — change it alongside whenever you change what they must contain. `mcp/config.ts` is deliberately *not* a template: one container, one agent, so the server list is part of the build.

## Commit Style

Do not add "Generated with Claude Code" footers or "Co-Authored-By" trailers to commit messages.
