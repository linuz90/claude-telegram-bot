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
# --production skips @types/bun. typescript comes in anyway as a peer dependency.
#
# Since v0.3 the agent SDK ships the Claude Code CLI as a ~290MB native binary
# per platform, and bun installs both the glibc and the musl build for this
# architecture because nothing in the package metadata distinguishes them. This
# base image is Debian, so the musl one cannot even be executed - dropping it in
# the same layer halves the image.
#
# bun's download cache is written to $HOME and would otherwise be baked into
# this layer at roughly the size of node_modules again.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
    && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-*-musl \
    && rm -rf /root/.bun/install/cache

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
