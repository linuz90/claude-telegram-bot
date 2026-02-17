# Claude/Codex Telegram Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.0+-black.svg)](https://bun.sh/)

**Turn [Claude Code](https://claude.com/product/claude-code) or Codex into your personal assistant, accessible from anywhere via Telegram.**

Send text, voice, photos, documents, audio, and video. See responses and tools usage in real-time.

![Demo](assets/demo.gif)

## Claude Code as a Personal Assistant

I've started using Claude Code as a personal assistant, and I've built this bot so I can access it from anywhere.

In fact, while Claude Code is described as a powerful AI **coding agent**, it's actually a very capable **general-purpose agent** too when given the right instructions, context, and tools.

To achieve this, I set up a folder with a CLAUDE.md that teaches Claude about me (my preferences, where my notes live, my workflows), has a set of tools and scripts based on my needs, and pointed this bot at that folder.

→ **[📄 See the Personal Assistant Guide](docs/personal-assistant-guide.md)** for detailed setup and examples.

## Bot Features

- 💬 **Text**: Ask questions, give instructions, have conversations
- 🎤 **Voice**: Speak naturally - transcribed via OpenAI and processed by the selected assistant
- 📸 **Photos**: Send screenshots, documents, or anything visual for analysis
- 📄 **Documents**: PDFs, text files, and archives (ZIP, TAR) are extracted and analyzed
- 🎵 **Audio**: Audio files (mp3, m4a, ogg, wav, etc.) are transcribed via OpenAI and processed
- 🎬 **Video**: Video messages and video notes are processed by Claude
- 🔄 **Session persistence**: Conversations continue across messages
- 📨 **Message queuing**: Send multiple messages while Claude works - they queue up automatically. Prefix with `!` or use `/stop` to interrupt and send immediately
- 🧠 **Extended thinking**: Trigger Claude's reasoning by using words like "think" or "reason" - you'll see its thought process as it works (configurable via `THINKING_TRIGGER_KEYWORDS`)
- 🔘 **Interactive buttons**: Claude can present options as tappable inline buttons via the built-in `ask_user` MCP tool

## Quick Start

```bash
git clone https://github.com/linuz90/claude-telegram-bot?tab=readme-ov-file
cd claude-telegram-bot-ts

cp .env.example .env
# Edit .env with your credentials

bun install
bun run src/index.ts
# or directly start in Codex mode
bun run start:codex
```

### Prerequisites

- **Bun 1.0+** - [Install Bun](https://bun.sh/)
- **Claude Agent SDK** - `@anthropic-ai/claude-agent-sdk` (for Claude mode)
- **Codex SDK** - `@openai/codex-sdk` (for Codex mode, installed via bun install)
- **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
- **OpenAI API Key** (optional, for voice transcription)

### Assistant Selection

Choose which assistant powers the bot:

```bash
# .env
AI_ASSISTANT=claude   # or codex
```

If `AI_ASSISTANT=codex`, authenticate once on the host machine:

```bash
codex login
```

### Claude Authentication

The bot uses the `@anthropic-ai/claude-agent-sdk` which supports two authentication methods:

| Method                     | Best For                                | Setup                             |
| -------------------------- | --------------------------------------- | --------------------------------- |
| **CLI Auth** (recommended) | High usage, cost-effective              | Run `claude` once to authenticate |
| **API Key**                | CI/CD, environments without Claude Code | Set `ANTHROPIC_API_KEY` in `.env` |

**CLI Auth** (recommended): The SDK automatically uses your Claude Code login. Just ensure you've run `claude` at least once and authenticated. This uses your Claude Code subscription which is much more cost-effective for heavy usage.

**API Key**: For environments where Claude Code isn't installed. Get a key from [console.anthropic.com](https://console.anthropic.com/) and add to `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Note: API usage is billed per token and can get expensive quickly for heavy use.

## Configuration

### 1. Create Your Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts to create your bot
3. Copy the token (looks like `1234567890:ABC-DEF...`)

Then send `/setcommands` to BotFather and paste this:

```
start - Show status and user ID
new - Start a fresh session
policy - Show runtime policy
model - Switch assistant/model
assistant - Alias for /model
resume - Pick from recent sessions to resume
stop - Interrupt current query
status - Check what the bot is doing
restart - Restart the bot
```

### 2. Configure Environment

Create `.env` with your settings:

```bash
# Required
TELEGRAM_BOT_TOKEN=1234567890:ABC-DEF...   # From @BotFather
TELEGRAM_ALLOWED_USERS=123456789           # Your Telegram user ID

# Recommended
AI_WORKING_DIR=/path/to/your/folder        # Where the assistant runs (loads CLAUDE.md, skills, MCP)
AI_ASSISTANT=claude                        # or codex
CLAUDE_MODEL=claude-opus-4-6
CODEX_MODEL=gpt-5.3-codex
CODEX_REASONING_EFFORT=medium             # minimal | low | medium | high | xhigh
CODEX_SANDBOX_MODE=workspace-write        # read-only | workspace-write | danger-full-access
CODEX_APPROVAL_POLICY=never               # never | on-request | on-failure | untrusted
CODEX_NETWORK_ACCESS_ENABLED=true
CODEX_WEB_SEARCH_MODE=live                # disabled | cached | live
OPENAI_API_KEY=sk-...                      # For voice transcription
```

**Finding your Telegram user ID:** Message [@userinfobot](https://t.me/userinfobot) on Telegram.

**File access paths:** By default, the assistant can access:

- `AI_WORKING_DIR` / `CLAUDE_WORKING_DIR` (or home directory if not set)
- `~/Documents`, `~/Downloads`, `~/Desktop`
- `~/.claude` (for Claude Code plans and settings)

To customize, set `ALLOWED_PATHS` in `.env` (comma-separated). Note: this **overrides** all defaults, so include `~/.claude` if you want plan mode to work:

```bash
ALLOWED_PATHS=/your/project,/other/path,~/.claude
```

### 3. Configure MCP Servers (Optional)

Copy and edit the MCP config:

```bash
cp mcp-config.ts mcp-config.local.ts
# Edit mcp-config.local.ts with your MCP servers
```

The bot includes a built-in `ask_user` MCP server that lets Claude present options as tappable inline keyboard buttons. Add your own MCP servers (Things, Notion, Typefully, etc.) to give Claude access to your tools.

## Bot Commands

| Command    | Description                       |
| ---------- | --------------------------------- |
| `/start`   | Show status and your user ID      |
| `/new`     | Start a fresh session             |
| `/policy`  | Show runtime policy               |
| `/model`   | Switch assistant/model            |
| `/assistant` | Alias for `/model`              |
| `/resume`  | Pick from last 5 sessions to resume (with recap) |
| `/stop`    | Interrupt current query           |
| `/status`  | Check what the bot is doing       |
| `/restart` | Restart the bot                   |

Model switch format (canonical):

```text
/model opus 4.6
/model sonnet 4.5
/model codex 5.3 low
/model codex 5.3 medium
/model codex 5.3 high
```

## Running as a Service (macOS)

```bash
cp launchagent/com.claude-telegram-ts.plist.template ~/Library/LaunchAgents/com.claude-telegram-ts.plist
# Edit the plist with your paths and env vars
launchctl load ~/Library/LaunchAgents/com.claude-telegram-ts.plist
```

The bot will start automatically on login and restart if it crashes.

**Prevent sleep:** To keep the bot running when your Mac is idle, go to **System Settings → Battery → Options** and enable **"Prevent automatic sleeping when the display is off"** (when on power adapter).

**Logs:**

```bash
tail -f /tmp/claude-telegram-bot-ts.log   # stdout
tail -f /tmp/claude-telegram-bot-ts.err   # stderr
```

**Shell aliases:** If running as a service, these aliases make it easy to manage the bot (add to `~/.zshrc` or `~/.bashrc`):

```bash
alias cbot='launchctl list | grep com.claude-telegram-ts'
alias cbot-stop='launchctl bootout gui/$(id -u)/com.claude-telegram-ts 2>/dev/null && echo "Stopped"'
alias cbot-start='launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.claude-telegram-ts.plist 2>/dev/null && echo "Started"'
alias cbot-restart='launchctl kickstart -k gui/$(id -u)/com.claude-telegram-ts && echo "Restarted"'
alias cbot-logs='tail -f /tmp/claude-telegram-bot-ts.log'
```

## Development

```bash
# Run with auto-reload
bun --watch run src/index.ts

# Run in Codex mode
bun run start:codex
bun run dev:codex

# Type check
bun run typecheck

# Or directly
bun run --bun tsc --noEmit
```

## Security

> **⚠️ Important:** This bot runs Claude Code with **all permission prompts bypassed**. Claude can read, write, and execute commands without confirmation within the allowed paths. This is intentional for a seamless mobile experience, but you should understand the implications before deploying.

**→ [Read the full Security Model](SECURITY.md)** for details on how permissions work and what protections are in place.

Multiple layers protect against misuse:

1. **User allowlist** - Only your Telegram IDs can use the bot
2. **Intent classification** - AI filter blocks dangerous requests
3. **Path validation** - File access restricted to `ALLOWED_PATHS`
4. **Command safety** - Destructive patterns like `rm -rf /` are blocked
5. **Rate limiting** - Prevents runaway usage
6. **Audit logging** - All interactions logged to `/tmp/claude-telegram-audit.log`

## Troubleshooting

**Bot doesn't respond**

- Verify your user ID is in `TELEGRAM_ALLOWED_USERS`
- Check the bot token is correct
- Look at logs: `tail -f /tmp/claude-telegram-bot-ts.err`
- Ensure the bot process is running

**Claude authentication issues**

- For CLI auth: run `claude` in terminal and verify you're logged in
- For API key: check `ANTHROPIC_API_KEY` is set and starts with `sk-ant-api03-`
- Verify the API key has credits at [console.anthropic.com](https://console.anthropic.com/)

**Voice messages fail**

- Ensure `OPENAI_API_KEY` is set in `.env`
- Verify the key is valid and has credits

**Claude can't access files**

- Check `CLAUDE_WORKING_DIR` points to an existing directory
- Verify `ALLOWED_PATHS` includes directories you want Claude to access
- Ensure the bot process has read/write permissions

**MCP tools not working**

- Verify `mcp-config.ts` exists and exports properly
- Check that MCP server dependencies are installed
- Look for MCP errors in the logs

## License

MIT
