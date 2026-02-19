# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run start      # Run the bot
bun run dev        # Run with auto-reload (--watch)
bun run typecheck  # Run TypeScript type checking
bun install        # Install dependencies
```

## Architecture

This is a Telegram bot (~3,300 lines TypeScript) that lets you control Claude Code from your phone via text, voice, photos, and documents. Built with Bun and grammY.

### Message Flow

```
Telegram message → Handler → Auth check → Rate limit → Claude session → Streaming response → Audit log
```

### Key Modules

- **`src/index.ts`** - Entry point, registers handlers, starts polling
- **`src/config.ts`** - Environment parsing, MCP loading, safety prompts
- **`src/session.ts`** - `ClaudeSession` class wrapping Agent SDK V2 with streaming, session persistence (`<AI_RUNTIME_DIR>/claude-telegram-session.json`), and defense-in-depth safety checks
- **`src/security.ts`** - `RateLimiter` (token bucket), path validation, command safety checks
- **`src/formatting.ts`** - Markdown→HTML conversion for Telegram, tool status emoji formatting
- **`src/utils.ts`** - Audit logging, voice transcription (OpenAI), typing indicators
- **`src/types.ts`** - Shared TypeScript types

### Handlers (`src/handlers/`)

Each message type has a dedicated async handler:
- **`commands.ts`** - `/start`, `/new`, `/stop`, `/status`, `/resume`, `/restart`, `/retry`
- **`text.ts`** - Text messages with intent filtering
- **`voice.ts`** - Voice→text via OpenAI, then same flow as text
- **`audio.ts`** - Audio file transcription via OpenAI (mp3, m4a, ogg, wav, etc.), also handles audio sent as documents
- **`photo.ts`** - Image analysis with media group buffering (1s timeout for albums)
- **`document.ts`** - PDF extraction (pdftotext CLI), text files, archives, routes audio files to `audio.ts`
- **`video.ts`** - Video messages and video notes
- **`callback.ts`** - Inline keyboard button handling for ask_user MCP
- **`streaming.ts`** - Shared `StreamingState` and status callback factory

### Security Layers

1. User allowlist (`TELEGRAM_ALLOWED_USERS`)
2. Rate limiting (token bucket, configurable)
3. Path validation (`ALLOWED_PATHS`)
4. Command safety (blocked patterns)
5. System prompt constraints
6. Audit logging

### Configuration

All config via `.env` (copy from `.env.example`). Key variables:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS` (required)
- `AI_WORKING_DIR` / `CLAUDE_WORKING_DIR` - Working directory for the assistant
- `ALLOWED_PATHS` - Directories Claude can access
- `OPENAI_API_KEY` - For voice transcription
- `CLAUDE_ENABLE_CHROME` - Enables Claude Code native Chrome control (`--chrome`)

MCP servers defined in `mcp-config.ts`.

### Runtime Files

- `<AI_RUNTIME_DIR>/claude-telegram-session.json` - Session persistence for `/resume`
- `<AI_RUNTIME_DIR>/telegram-bot/` - Downloaded photos/documents
- `<AI_RUNTIME_DIR>/claude-telegram-audit.log` - Audit log

### Claude in Chrome Integration

To enable browser control from Telegram:

1. Set `CLAUDE_ENABLE_CHROME=true` in `.env`.
2. Restart the running bot process (LaunchAgent or manual process).
3. Ensure Claude Chrome extension is installed and Chrome is running.

If you see "Browser extension isn't connected" while the bot is passing Chrome tools:

- Verify Claude Code host manifest exists:
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json`
- Check for host conflict with Claude Desktop manifest:
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json`
- If conflict occurs, disable Desktop manifest temporarily and restart Chrome.
- Verify active host process:
  `ps aux | rg 'chrome-native-host|claude-agent-sdk/cli.js --chrome-native-host'`

## Patterns

**Adding a command**: Create handler in `commands.ts`, register in `index.ts` with `bot.command("name", handler)`

**Adding a message handler**: Create in `handlers/`, export from `index.ts`, register in `index.ts` with appropriate filter

**Streaming pattern**: All handlers use `createStatusCallback()` from `streaming.ts` and `session.sendMessageStreaming()` for live updates.

**Type checking**: Run `bun run typecheck` periodically while editing TypeScript files. Fix any type errors before committing.

**After code changes**: Restart the bot so changes can be tested. Use `launchctl kickstart -k gui/$(id -u)/com.claude-telegram-ts` if running as a service, or `bun run start` for manual runs.

## Standalone Build

The bot can be compiled to a standalone binary with `bun build --compile`. This is used by the ClaudeBot macOS app wrapper.

### External Dependencies

PDF extraction uses `pdftotext` CLI instead of an npm package (to avoid bundling issues):

```bash
brew install poppler  # Provides pdftotext
```

### PATH Requirements

When running as a standalone binary (especially from a macOS app), the PATH may not include Homebrew. The launcher must ensure PATH includes:
- `/opt/homebrew/bin` (Apple Silicon Homebrew)
- `/usr/local/bin` (Intel Homebrew)

Without this, `pdftotext` won't be found and PDF parsing will fail silently with an error message.

## Commit Style

Do not add "Generated with Claude Code" footers or "Co-Authored-By" trailers to commit messages.

## Running as Service (macOS)

Currently running as a LaunchAgent (`com.claude-telegram-ts`).

```bash
# Restart
launchctl kickstart -k gui/$(id -u)/com.claude-telegram-ts

# Stop
launchctl bootout gui/$(id -u)/com.claude-telegram-ts

# Logs
tail -f /tmp/claude-telegram-bot.log
tail -f /tmp/claude-telegram-bot.err
```

Plist: `~/Library/LaunchAgents/com.claude-telegram-ts.plist`
Agent workspace: `~/Programming_Projects/claude-code-telegram-bot/workspace` (AI_WORKING_DIR)
