FROM oven/bun:1.3.13

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git npm \
  && npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli \
  && mkdir -p /tmp/telegram-bot /home/bun/.claude /home/bun/.codex /home/bun/.gemini \
  && chown -R bun:bun /tmp/telegram-bot /home/bun/.claude /home/bun/.codex /home/bun/.gemini \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY . .

CMD ["bun", "run", "start"]
