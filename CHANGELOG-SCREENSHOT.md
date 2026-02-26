# Screenshot Feature - Changelog

## New Feature: Screenshot Capability

Added the ability for Claude to take screenshots and send them to Telegram when asked.

### What's New

#### MCP Server
- **New file**: `screenshot_mcp/server.ts` - MCP server that handles screenshot capture
- Uses macOS `screencapture` command
- Supports full screen and window selection modes
- Optional description/caption for screenshots

#### Handler
- **New file**: `src/handlers/screenshot.ts` - Monitors for screenshot files and sends to Telegram
- Automatically detects and sends screenshots after Claude captures them
- Cleans up temporary files after sending

#### Integration
- **Modified**: `src/session.ts` - Added screenshot monitoring after MCP tool usage
- **Modified**: `src/formatting.ts` - Added 📸 emoji and formatting for screenshot tool
- **Modified**: `src/handlers/index.ts` - Exported screenshot handler

#### Configuration
- **New file**: `mcp-config.ts` - Default MCP configuration with screenshot enabled
- **Modified**: `mcp-config.example.ts` - Updated example to include screenshot server
- **Modified**: `.gitignore` - Keeps mcp-config.ts ignored for user customization

#### Documentation
- **New file**: `docs/screenshot-feature.md` - Technical documentation
- **New file**: `docs/screenshot-examples.md` - Usage examples and workflows
- **New file**: `SCREENSHOT-SETUP.md` - Quick setup guide
- **Modified**: `README.md` - Added screenshot to features list

### Usage

Ask Claude to take a screenshot:
```
You: Take a screenshot
Claude: 📸 Taking screenshot
[Screenshot appears in chat]
```

With description:
```
You: Take a screenshot of this error
Claude: 📸 Taking screenshot: Here is the error message
[Screenshot appears in chat]
```

Window selection:
```
You: Take a screenshot of my browser window
Claude: 📸 Taking screenshot (window)
[Click on window to capture]
[Screenshot appears in chat]
```

### Requirements

- macOS (uses `screencapture` command)
- Screen recording permissions in System Settings
- Bun runtime

### Files Changed

```
New files:
  screenshot_mcp/server.ts
  src/handlers/screenshot.ts
  mcp-config.ts
  docs/screenshot-feature.md
  docs/screenshot-examples.md
  SCREENSHOT-SETUP.md
  CHANGELOG-SCREENSHOT.md

Modified files:
  src/session.ts
  src/formatting.ts
  src/handlers/index.ts
  mcp-config.example.ts
  README.md
```

### Technical Details

**How it works:**
1. User asks Claude to take a screenshot
2. Claude calls `mcp__screenshot__take_screenshot` tool
3. MCP server captures screenshot using `screencapture`
4. Server writes metadata file to `/tmp/telegram-bot/`
5. Session handler detects metadata file
6. Handler sends screenshot to Telegram
7. Temporary files are cleaned up

**Security:**
- Screenshots only sent to authorized Telegram chat
- Files stored temporarily in `/tmp/telegram-bot/`
- Automatic cleanup after sending
- No external services involved (except Telegram)

### Platform Support

Currently macOS only. Future support planned for:
- Linux (using `scrot` or `gnome-screenshot`)
- Windows (using PowerShell or `snippingtool`)

### Known Limitations

- macOS only
- Single display capture (multi-monitor support coming)
- No scheduled/automatic screenshots
- No screen recording (video)

### Setup

See [SCREENSHOT-SETUP.md](SCREENSHOT-SETUP.md) for detailed setup instructions.

### Examples

See [docs/screenshot-examples.md](docs/screenshot-examples.md) for usage examples and workflows.

### Troubleshooting

Common issues and solutions in [SCREENSHOT-SETUP.md](SCREENSHOT-SETUP.md#troubleshooting).

---

**Version**: 1.0.0  
**Date**: February 2026  
**Platform**: macOS  
**Status**: Stable
