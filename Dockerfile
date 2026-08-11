FROM oven/bun:1-debian

# pdftotext (poppler-utils) and unzip are shelled out to by src/handlers/document.ts
# for PDF and archive extraction. Without them those handlers fail at runtime.
#
# git is deliberately absent: it costs ~150MB once apt pulls in perl, and an
# assistant-style agent never calls it. Add it here if your agent works on
# repositories.
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils \
      unzip \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so they stay cached when only source changes.
COPY package.json bun.lock bunfig.toml ./
# --production skips devDependencies (typescript, @types/bun): needed for
# `bun run typecheck` during development, dead weight in a container.
RUN bun install --frozen-lockfile --production

COPY . .

# Persistent state: session file, audit log, and Telegram downloads.
# Mount a volume here or /resume breaks on every restart.
ENV STATE_DIR=/data

# Where Claude does its work. Mount your agent's files here.
ENV CLAUDE_WORKING_DIR=/workspace

# Only the writable directories are chowned. /app stays root-owned and
# world-readable, which is all the bun user needs to read its own code and
# node_modules. A recursive chown over /app would rewrite every file into a new
# layer - 178MB for a metadata change, since layers are copy-on-write.
RUN mkdir -p /data /workspace && chown bun:bun /data /workspace

# The agent has shell access, so don't hand it root.
USER bun

# The Agent SDK spawns its own bundled Claude Code CLI (node_modules/@anthropic-ai/
# claude-agent-sdk/cli.js) and runs it with "bun" when the parent is Bun, so no
# separate Claude Code install is needed.
CMD ["bun", "run", "src/index.ts"]
