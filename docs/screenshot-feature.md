# Screenshot Feature

The bot can now take screenshots and send them to you via Telegram when you ask Claude.

## How It Works

1. You ask Claude to take a screenshot (e.g., "take a screenshot of my screen")
2. Claude uses the `take_screenshot` MCP tool
3. The screenshot is captured using macOS `screencapture` command
4. The screenshot is automatically sent to your Telegram chat
5. The file is cleaned up after sending

## Usage Examples

### Basic Screenshot
```
You: Take a screenshot
Claude: [Takes screenshot and sends it to you]
```

### Screenshot with Description
```
You: Take a screenshot and show me what's on my screen
Claude: [Takes screenshot with description and sends it]
```

### Window Selection
```
You: Take a screenshot of a specific window
Claude: [Allows you to click on a window to capture]
```

## Technical Details

### MCP Server
- Location: `screenshot_mcp/server.ts`
- Tool: `take_screenshot`
- Platform: macOS only (uses `screencapture` command)

### Parameters
- `window` (boolean, optional): If true, allows interactive window selection
- `description` (optional): Caption for the screenshot

### File Storage
- Screenshots are temporarily stored in `/tmp/telegram-bot/`
- Metadata files: `/tmp/telegram-bot/screenshot_*.json`
- Files are automatically cleaned up after sending

### Security
- Screenshots are only sent to the authorized Telegram chat
- Files are stored locally and never sent to external services (except Telegram)
- Temporary files are deleted after sending

## Configuration

The screenshot MCP server is enabled in `mcp-config.ts`:

```typescript
export const MCP_SERVERS = {
  screenshot: {
    command: "bun",
    args: ["run", `${REPO_ROOT}/screenshot_mcp/server.ts`],
  },
};
```

To disable, comment out or remove the `screenshot` entry.

## Troubleshooting

### Screenshots not working
1. Ensure you're on macOS (uses `screencapture` command)
2. Check that `mcp-config.ts` includes the screenshot server
3. Verify the bot has screen recording permissions:
   - System Settings → Privacy & Security → Screen Recording
   - Enable for Terminal or your terminal app

### Screenshots not being sent
1. Check the logs: `tail -f /tmp/claude-telegram-bot-ts.log`
2. Verify `/tmp/telegram-bot/` directory exists and is writable
3. Check for screenshot files: `ls -la /tmp/telegram-bot/screenshot_*`

### Permission denied errors
Grant screen recording permissions:
1. Open System Settings
2. Go to Privacy & Security → Screen Recording
3. Enable for your terminal app (Terminal, iTerm2, etc.)
4. Restart the bot

## Privacy Note

Screenshots capture whatever is visible on your screen at the time. Be mindful of:
- Sensitive information in open windows
- Personal data in browser tabs
- Notifications or messages

The screenshot is sent directly to your Telegram chat and stored temporarily on your local machine only.

## Platform Support

Currently macOS only. For other platforms:
- **Linux**: Replace `screencapture` with `scrot` or `gnome-screenshot`
- **Windows**: Replace with `snippingtool` or PowerShell screenshot commands

Pull requests welcome for cross-platform support!
