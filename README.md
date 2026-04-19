# Maket

Visual design tool for [Claude](https://claude.ai/code) — compose HTML/CSS documents with live preview, manage assets, apply brand chartes, export PDF, send via Gmail. Exposes an MCP server so Claude can drive the canvas directly.

## Requirements

- Node.js `>=22`
- Claude Code (or any MCP-compatible client over Streamable HTTP)

## Install

```bash
git clone https://github.com/ng-galien/maket.git
cd maket
npm install
```

## Run

```bash
npm run dev
```

This starts the MCP/preview server on `:3333` and the Vite dev server on `:5173`.

Open Claude Code from the project directory — `.mcp.json` points it at `http://localhost:3333/mcp`. Then open `http://localhost:5173` in your browser for the live preview.

## Commands

```bash
npm run dev            # Server --watch + Vite dev server (HMR on :5173, API on :3333)
npm run dev:watch      # Server --watch + client `vite build --watch` → public/
npm run dev:server     # Server only, --watch
npm run dev:client     # Vite dev server only
npm run build:client   # Vite production build → public/
npm run lint           # biome check
npm run test           # vitest run
npm run quality        # lint + typecheck + test
npm run start          # Start server only (no client build)
```

## Project structure

Monorepo with npm workspaces:

- `packages/server/` — MCP server (Streamable HTTP) + Express + WebSocket
- `packages/client/` — React 19 + Vite + Tailwind CSS 4
- `packages/shared/` — Shared TypeScript types
- `plugin/skills/` — Claude Code skills (`maket`, `maket-charte`, `maket-review`)

## Bootstrap a downstream workspace

If you run Maket as a long-lived server and want other projects to connect to it:

```bash
make bootstrap DIR=/path/to/my-project PORT=3335
```

Creates `.mcp.json`, `.claude/skills/`, and a `package.json` with `npm run dev` in the target directory. Never overwrites existing files.

## Gmail integration (optional)

1. Create OAuth credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Add redirect URI: `http://localhost:3333/auth/google/callback`
3. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
4. Use `maket_gmail connect` to authenticate

## Data locations

By default Maket stores data in `~/.maket/`:

- `documents.db` — SQLite (documents, chartes, assets metadata)
- `assets/`, `documents/`, `exports/` — user files

Override with `MAKET_DATA_DIR` or `MAKET_DB`.

## License

MIT — see [LICENSE](LICENSE).
