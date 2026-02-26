# Screenshot Feature Setup

Quick guide to enable the screenshot feature in your Claude Telegram bot.

## Prerequisites

- macOS (uses `screencapture` command)
- Screen recording permissions for your terminal app
- Bot already configured and running

## Setup Steps

### 1. Copy MCP Configuration

If you don't have `mcp-config.ts` yet:

```bash
cp mcp-config.example.ts mcp-config.ts
```

The screenshot server is already enabled in the example config.

### 2. Grant Screen Recording Permissions

1. Open **System Settings**
2. Go to **Privacy & Security** → **Screen Recording**
3. Enable for your terminal app (Terminal, iTerm2, etc.)
4. Restart your terminal

### 3. Restart the Bot

```bash
# If running manually:
bun run src/index.ts

# If running as a service:
launchctl kickstart -k gui/$(id -u)/com.claude-telegram-ts
```

### 4. Test It

Send a message to your bot:

```
take a screenshot
```

Claude should capture your screen and send it to you!

## Verification

Check that the MCP server is loaded:

```bash
# Look for this in the bot startup logs:
# "Loaded 2 MCP servers from mcp-config.ts"
```

## Troubleshooting

### "Screenshot failed" error

**Check permissions:**
```bash
# Test screencapture directly:
screencapture -x /tmp/test.png && open /tmp/test.png
```

If this fails, you need to grant screen recording permissions.

**Check the bot logs:**
```bash
tail -f /tmp/claude-telegram-bot-ts.log
```

### Screenshot not appearing in chat

**Verify temp directory:**
```bash
ls -la /tmp/telegram-bot/
```

Should show `screenshot_*.json` and `screenshot_*.png` files briefly.

**Check bot has write permissions:**
```bash
touch /tmp/telegram-bot/test.txt
```

### MCP server not loading

**Verify the file exists:**
```bash
ls -la screenshot_mcp/server.ts
```

**Check it's executable:**
```bash
chmod +x screenshot_mcp/server.ts
```

**Test the MCP server directly:**
```bash
bun run screenshot_mcp/server.ts
```

Should output: "Screenshot MCP server running on stdio"

## Usage Examples

Once set up, you can ask Claude:

- "Take a screenshot"
- "Show me what's on my screen"
- "Capture a screenshot of this error"
- "Take a screenshot and analyze what applications are open"
- "Screenshot my browser window" (interactive window selection)

See [docs/screenshot-examples.md](docs/screenshot-examples.md) for more examples.

## Security Notes

- Screenshots capture everything visible on your screen
- Be mindful of sensitive information (passwords, API keys, personal data)
- Screenshots are stored temporarily in `/tmp/telegram-bot/`
- Files are automatically deleted after sending to Telegram
- Only sent to your authorized Telegram chat

## Disabling the Feature

To disable screenshots:

1. Edit `mcp-config.ts`
2. Comment out or remove the `screenshot` entry:
   ```typescript
   // screenshot: {
   //   command: "bun",
   //   args: ["run", `${REPO_ROOT}/screenshot_mcp/server.ts`],
   // },
   ```
3. Restart the bot

## Platform Support

Currently **macOS only**. For other platforms:

**Linux:**
Replace `screencapture` with `scrot` or `gnome-screenshot` in `screenshot_mcp/server.ts`

**Windows:**
Replace with PowerShell screenshot commands or `snippingtool`

Pull requests welcome for cross-platform support!

## Next Steps

- Try the examples in [docs/screenshot-examples.md](docs/screenshot-examples.md)
- Combine with other MCP tools for powerful workflows
- Read the technical details in [docs/screenshot-feature.md](docs/screenshot-feature.md)

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review the logs: `tail -f /tmp/claude-telegram-bot-ts.log`
3. Verify permissions in System Settings
4. Test `screencapture` command directly

Happy screenshotting! 📸
