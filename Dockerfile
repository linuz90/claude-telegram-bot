FROM oven/bun:1-debian

# pdftotext (poppler-utils) and unzip are shelled out to by src/handlers/document.ts
# for PDF and archive extraction. Without them those handlers fail at runtime.
# git is there for the agent itself, not the bot.
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils \
      unzip \
      git \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so they stay cached when only source changes.
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .

# Persistent state: session file, audit log, and Telegram downloads.
# Mount a volume here or /resume breaks on every restart.
ENV STATE_DIR=/data

# Where Claude does its work. Mount your agent's files here.
ENV CLAUDE_WORKING_DIR=/workspace

RUN mkdir -p /data /workspace && chown -R bun:bun /data /workspace /app

# The agent has shell access, so don't hand it root.
USER bun

# The Agent SDK spawns its own bundled Claude Code CLI (node_modules/@anthropic-ai/
# claude-agent-sdk/cli.js) and runs it with "bun" when the parent is Bun, so no
# separate Claude Code install is needed.
CMD ["bun", "run", "src/index.ts"]
