FROM oven/bun:1-debian

# pdftotext and unzip are shelled out to by src/handlers/document.ts and are not
# in the base image. ca-certificates is not needed by Bun, which bundles its own
# CA store, but is by anything the agent shells out to over HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils \
      unzip \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so they stay cached when only source changes.
# --production skips typescript and @types/bun: dead weight in a container.
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

COPY . .

# Everything the agent touches lives under its working directory: instructions
# and skills from the image, state from the bind mount at data/.
ENV CLAUDE_WORKING_DIR=/app/agent
ENV STATE_DIR=/app/agent/data

# Only the writable paths are chowned. A recursive chown over all of /app would
# rewrite every file into a new layer - 178MB for a metadata change.
RUN mkdir -p /app/agent/data && chown -R bun:bun /app/agent

# The agent has shell access, so don't hand it root.
USER bun

CMD ["bun", "run", "src/index.ts"]
