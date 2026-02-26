# Screenshot Feature - Quick Start

## 30-Second Setup

```bash
# 1. Copy MCP config (if you don't have it)
cp mcp-config.example.ts mcp-config.ts

# 2. Grant screen recording permissions
# System Settings → Privacy & Security → Screen Recording → Enable for Terminal

# 3. Restart the bot
bun run src/index.ts
```

## Usage

Just ask Claude in Telegram:

```
take a screenshot
```

That's it! 📸

## Common Commands

| What you say | What happens |
|--------------|--------------|
| "take a screenshot" | Captures full screen |
| "screenshot this error" | Captures with description |
| "screenshot my browser" | Interactive window selection |
| "show me what's on my screen" | Captures and analyzes |

## Troubleshooting

**Not working?**

1. Check permissions: System Settings → Privacy & Security → Screen Recording
2. Restart terminal after granting permissions
3. Verify MCP config: `cat mcp-config.ts | grep screenshot`

**Still not working?**

```bash
# Test screencapture directly:
screencapture -x /tmp/test.png && open /tmp/test.png

# Check bot logs:
tail -f /tmp/claude-telegram-bot-ts.log
```

## More Info

- Full setup: [SCREENSHOT-SETUP.md](SCREENSHOT-SETUP.md)
- Examples: [docs/screenshot-examples.md](docs/screenshot-examples.md)
- Technical details: [docs/screenshot-feature.md](docs/screenshot-feature.md)

---

**Platform**: macOS only  
**Requires**: Screen recording permissions
