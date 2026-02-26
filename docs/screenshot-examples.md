# Screenshot Feature - Usage Examples

Here are practical examples of how to use the screenshot feature with your Claude Telegram bot.

## Basic Usage

### Simple Screenshot Request
```
You: Take a screenshot
Claude: 📸 Taking screenshot
[Screenshot appears in chat]
Claude: I've captured your screen. What would you like to know about it?
```

### Screenshot with Analysis
```
You: Take a screenshot and tell me what applications are open
Claude: 📸 Taking screenshot
[Screenshot appears in chat]
Claude: I can see you have the following applications open:
- Safari with multiple tabs
- Terminal running a Node.js server
- VS Code with a TypeScript file
- Slack in the background
```

## Advanced Usage

### Screenshot with Context
```
You: I'm getting an error. Take a screenshot and help me debug it
Claude: 📸 Taking screenshot: Here is the error message
[Screenshot appears in chat]
Claude: I can see the error in your terminal. The issue is...
```

### Window-Specific Screenshot
```
You: Take a screenshot of just my browser window
Claude: 📸 Taking screenshot (window)
[You click on the browser window]
[Screenshot of just that window appears]
Claude: Here's your browser window. I can see you're on...
```

### Screenshot for Documentation
```
You: Take a screenshot of my dashboard for the documentation
Claude: 📸 Taking screenshot: Dashboard view for documentation
[Screenshot appears in chat]
Claude: I've captured your dashboard. Would you like me to:
1. Add annotations
2. Crop specific sections
3. Create documentation text to go with it
```

## Workflow Examples

### Debugging Session
```
You: I'm stuck on this bug
Claude: What's the issue?

You: Take a screenshot of the error
Claude: 📸 Taking screenshot
[Screenshot appears]
Claude: I see the error. The problem is in line 42...

You: Can you show me the fix?
Claude: Here's the corrected code: [provides solution]

You: Take another screenshot to confirm it's working
Claude: 📸 Taking screenshot
[Screenshot appears]
Claude: Perfect! The error is gone and your app is running correctly.
```

### Design Review
```
You: Take a screenshot of my website
Claude: 📸 Taking screenshot
[Screenshot appears]

You: What do you think of the design?
Claude: The layout looks clean. Here are some suggestions:
- The header could use more padding
- Consider increasing the contrast on the CTA button
- The footer text is a bit small

You: Make those changes and take another screenshot
Claude: [Makes changes via code]
📸 Taking screenshot
[New screenshot appears]
Claude: Here's the updated design with your changes applied.
```

### Monitoring
```
You: Take a screenshot of my system monitor every 5 minutes
Claude: I can take a screenshot now, but I can't schedule recurring screenshots automatically. However, I can take one now and you can ask me again later.

📸 Taking screenshot
[Screenshot appears]
Claude: Your system is using 45% CPU and 8GB of RAM. Everything looks normal.
```

## Tips

### Be Specific
Instead of: "Take a screenshot"
Try: "Take a screenshot of the error message in my terminal"

### Provide Context
Instead of: "Screenshot this"
Try: "Take a screenshot of my code editor showing the bug on line 42"

### Combine with Other Actions
```
You: Take a screenshot, analyze the error, and write a fix to error.log
Claude: 📸 Taking screenshot
[Screenshot appears]
Claude: I see the error. Writing the fix...
📝 Writing to error.log
Claude: Done! The fix has been written to error.log
```

## Privacy Reminders

Before asking for a screenshot, make sure:
- No sensitive information is visible (passwords, API keys, personal data)
- No private messages or notifications are showing
- You're comfortable with the content being captured

The screenshot is sent directly to your Telegram chat and stored temporarily on your local machine only.

## Troubleshooting

### "Screenshot failed"
- Check screen recording permissions in System Settings
- Ensure you're on macOS
- Verify the bot has write access to `/tmp/telegram-bot/`

### Screenshot not appearing in chat
- Check the bot logs: `tail -f /tmp/claude-telegram-bot-ts.log`
- Verify your Telegram chat ID matches the bot's configuration
- Try restarting the bot

### Window selection not working
- Make sure you click on a window within 10 seconds
- Try using full screen mode instead: "Take a screenshot of the full screen"

## Limitations

- **macOS only**: Uses the `screencapture` command
- **No scheduling**: Can't take screenshots automatically on a schedule
- **No video**: Only captures still images, not screen recordings
- **Single screen**: Captures the main display only (multi-monitor support coming soon)

## Next Steps

- Combine screenshots with other MCP tools for powerful workflows
- Use screenshots for documentation, debugging, and monitoring
- Ask Claude to analyze screenshots and provide insights

See [screenshot-feature.md](screenshot-feature.md) for technical details.
