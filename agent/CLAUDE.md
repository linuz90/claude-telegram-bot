# Agent instructions

Replace this file with the agent's own instructions. It is copied to
`/app/agent` at build time and becomes the agent's working directory, so this is
what the Claude Agent SDK loads as its project instructions.

Everything in `agent/` ships in the image. Change it, rebuild, redeploy.

## Layout

```
agent/
├── CLAUDE.md          this file - the agent's main instructions
└── .claude/
    └── skills/        skills, auto-triggered by context
```

## Memory

Persistent notes go in `/app/agent/data/memory`. That directory is mounted from the host,
so it survives a redeploy.

Everything else, including this file, is replaced by the new image on every
deploy. Writing anywhere else in `/app/agent` is a way to lose work.
