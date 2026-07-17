# Contributing to syntx-ai-mcp

Thanks for your interest in contributing! 🎉

## Development setup

```bash
git clone <repo>
cd syntx-ai-mcp
npm install
npm run build        # tsup CJS + ESM + dts
npm run typecheck    # tsc --noEmit
npm run dev          # build in watch mode
```

Node.js **≥ 18** is required (the project uses built-in `fetch` and `WebSocket`).

## Project layout

```
src/
  bin/cli.ts          # entry point for `syntx-mcp` CLI
  config/             # env loading + Zod schema
  mcp/                # MCP server, tools, resources, prompts registry
  resources/          # SDK resource wrappers (chats, user, design, …)
  transport/          # stdio + HTTP+SSE transports
examples/             # runnable usage scenarios
docs/ARCHITECTURE.md  # layered architecture overview
```

## Adding a new tool

1. Create a new file in `src/mcp/tools/` exporting a `SyntxTool` object.
2. Register it in `src/mcp/tools/index.ts` inside `allTools`.
3. Run `npm run typecheck && npm run build` to confirm.

The same pattern applies for resources (`src/mcp/resources/`) and prompts
(`src/mcp/prompts/`).

## Coding style

- TypeScript strict mode is enabled (`tsconfig.json`).
- No external formatter is enforced — match the existing style: 2-space
  indent, single quotes, trailing commas where multi-line.
- Keep dependencies minimal. `package.json` has only `@modelcontextprotocol/sdk`
  as a runtime dependency.

## Security

**Never commit real syntx.ai bearer tokens.** If you need to test against the
live API, export `SYNTX_TOKEN` in your shell or use the `set-token` tool from
inside an MCP client.

If you discover a security issue, please open a private advisory instead of a
public issue.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) —
e.g. `feat: add list-folders tool`, `fix: handle 401 in transport` —
this keeps history grep-friendly and changelog generation painless.

## Pull requests

- One concern per PR.
- Update `README.md` and `docs/ARCHITECTURE.md` if you change user-facing
  behaviour.
- Ensure CI passes (`npm run build && npm run typecheck`).

## Reporting bugs

Open an issue with:

1. Reproduction steps.
2. Expected vs. actual behaviour.
3. `node --version`, OS, MCP client version.
4. Relevant logs (redact your token).
