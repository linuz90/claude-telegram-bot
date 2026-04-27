FROM oven/bun:1.2-alpine AS deps
WORKDIR /app
# BUILD_TS busts cache on bi-weekly scheduled rebuilds so caret ranges in
# package.json resolve to the latest published version (SDK, grammy, etc).
ARG BUILD_TS=local
RUN echo "build: $BUILD_TS"
COPY package.json bun.lock* ./
RUN bun install

FROM oven/bun:1.2-alpine

ARG BUILD_TS=local

# System dependencies
RUN apk add --no-cache git openssh-client curl jq ca-certificates bash

# kubectl
RUN curl -fsSL "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    -o /usr/local/bin/kubectl && chmod +x /usr/local/bin/kubectl

# flux CLI
RUN curl -fsSL https://fluxcd.io/install.sh | bash

# gh CLI
RUN apk add --no-cache github-cli

# Claude Code CLI (Agent SDK spawns this as subprocess).
# CLI prefix on PVC (chezmoi-init keeps `npm update -g` working at runtime).
# BUILD_TS busts this layer on scheduled rebuilds → fresh @latest install.
ENV NPM_CONFIG_PREFIX=/home/akhozya/.npm-global
ENV PATH="/home/akhozya/.npm-global/bin:$PATH"
RUN apk add --no-cache nodejs npm && \
    mkdir -p /home/akhozya/.npm-global && \
    echo "build: $BUILD_TS" && \
    npm install -g @anthropic-ai/claude-code@latest && \
    npm cache clean --force

# chezmoi (dotfile sync in init container uses same image)
RUN sh -c "$(curl -fsLS get.chezmoi.io)" -- -b /usr/local/bin

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# oven/bun:alpine already has UID 1000 as 'bun' user.
# Create akhozya as alias + home dir for K8s securityContext (runAsUser: 1000)
RUN deluser bun && adduser -D -u 1000 -h /home/akhozya akhozya

# Make /app and npm prefix writable so init container can update deps on restart
RUN chown -R akhozya:akhozya /app /home/akhozya/.npm-global
USER akhozya

CMD ["bun", "run", "src/index.ts"]
