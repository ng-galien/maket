# Maket

Visual design tool for Claude — compose HTML/CSS documents with live preview, manage assets, apply brand chartes, export PDF, send via Gmail.

## Commands

```bash
npm run dev            # Server --watch + Vite dev server (HMR on :5173, API on :24843, data in $PWD/.maket)
npm run dev:watch      # Server --watch + client `vite build --watch` → public/
npm run dev:server     # Server only, --watch
npm run dev:client     # Vite dev server only (HMR on :5173, proxies to :24843)
npm run build:client   # Vite production build → public/
npm run lint           # biome check
npm run lint:fix       # biome check --write
npm run test           # vitest run (coverage via test:coverage)
npm run quality        # lint + typecheck + test
npm run start          # Start server only (no client build)
```

Requires Node `>=22`.

Packaging: `node scripts/pack-mcpb.ts` → `dist/maket.mcpb` (Claude Desktop extension). Requires `npm install -g @anthropic-ai/mcpb`.

## MCP

The server exposes MCP via **Streamable HTTP** at `POST /mcp` on the same Express server as the preview.

`.mcp.json` configures Claude Code to connect via HTTP:
```json
{ "mcpServers": { "maket": { "type": "http", "url": "http://localhost:24842/mcp" } } }
```

**The server must be running** before Claude Code connects. Start it with `npm run dev` or `npm run dev:watch`.

## Monorepo structure

```
packages/
  server/               @maket/server — MCP + Express + WebSocket
    index.ts            Server entry (HTTP + MCP + WS + Awilix bootstrap)
    src/
      core/             tool-pack.ts, tool-pack-registry.ts, container.ts (mountTools)
      services/         DI singletons: bus, config, store, documents, wsRegistry, wsBridge, wsHandler, assets, gmailClient, layout, pdf
      tools/            MCP tool packs: mermaid, assets, chartes, pages, documents, canvas, html, pdf, gmail
      routes/           Express router factories: app, assets, chartes, export, oauth, mcp (+ index = mountRoutes)
      lib/              Pure utils: charte-check, charte-css
      types.ts          Domain types (Document, Page, Canvas, Charte)
      bootstrap.ts      createAppContainer — all service + router registrations
  client/               @maket/client — React 19 + Vite + Tailwind CSS 4
    src/
      components/       UI: Board, BottomBar, SidePanel, PageCanvas, etc.
      store/            Zustand store + WebSocket client
      i18n/             fr.json / en.json translations
  shared/               @maket/shared — Types shared between server and client
    src/index.ts        Canvas, Page, Document, DocMeta, DocSummary
plugin/                 Plugins — namespaced per host
  claude/               Claude Code plugin (skills + commands)
    skills/maket/         Design workflow skill + references
    skills/maket-charte/  Brand identity creation skill
    skills/maket-review/  Document QA/review skill
  commands/             Slash commands exposed to Claude Code
scripts/
  build.ts              Server build entry
  pack-mcpb.ts          Package as .mcpb bundle (uses manifest.json)
Makefile                `make bootstrap DIR=... PORT=...` scaffolds a downstream Maket workspace
public/                 Built client output (Vite → public/)
```

## Key patterns

- **HTML canvas model** — Documents are HTML/CSS pages. `maket_html set` composes, `maket_html patch` refines by `data-id`. Every visible element needs `data-id`.
- **Charte compliance** — `maket_html set`/`patch` reject only hardcoded colour *literals that duplicate a token value*, hardcoded font-family (when the charte defines fonts), and hardcoded box-shadow (when the charte defines shadows). Fresh colours that aren't already token values pass. `maket_page add` bypasses this check — structural op, not content.
- **Layout check is canvas-authoritative** — `maket_html set`/`patch`/`check` route through `LayoutService.measure`/`check`, which renders the page via headless Chromium at the canvas's true mm dimensions and falls back to a server-side mm-math walker when puppeteer is unavailable. Overflow is reported as `ⓘ Layout overflow — non-blocking:` — it's a hint, never an error. Browser-thumbnail measurements used to be wired via a WS `measureId` round-trip, but reported the thumbnail's container size, not the canvas. The WS path was removed; client sync now rides exclusively on the `documents.persist` → bus → `wsRegistry.broadcast` pipeline.
- **Compound tools** — the surface is 11 tools with action dispatch: `maket_doc`, `maket_page`, `maket_canvas`, `maket_html`, `maket_message`, `maket_charte`, `maket_image`, `maket_preview`, `maket_mermaid`, `maket_pdf`, `maket_gmail`. Each pack exports one compound ToolHandler (except canvas/mermaid/pdf which are single-action). Descriptions follow the `"When to use: …"` + action-table template.
- **`.maket` bundle format** — gzipped JSON (`{version, kind: "maket-bundle", documents[], chartes[]}`) built with `encodeBundle` / parsed with `decodeBundle` from `packages/server/src/lib/maket-format.ts`. Runtime doc fields are stripped; chartes referenced by `meta.charte` are embedded automatically. On import, doc names auto-suffix ` (imported)` on collision and charte names already present are skipped so the workspace's brand never gets overwritten silently. Exposed via `maket_doc action=export|import`, `GET /api/export-maket?name=|names=`, `POST /api/import-maket` (raw gzipped body), plus Import/Export controls in DocsTab.
- **MCP over HTTP** — Streamable HTTP transport, stateless (one server per request).
- **Store → broadcast** — Every mutation emits a bus event → WS broadcast to connected browsers.
- **Chartes** — Design tokens as CSS variables (`var(--charte-color-*)`). Fonts auto-injected via `@import`.
- **Screen formats** — DESKTOP (288×205mm, 1440×1024px), TABLET (167×239mm, 834×1194px), MOBILE (79×170mm, 393×852px). Scale: 1px ≈ 0.2mm.
- **Awilix is the single source of truth** — every service, tool pack, and HTTP route is a factory registered in `bootstrap.ts`. `index.ts` only wires boot + bus listeners + WS.
- **Factories over classes, everywhere** — services, tool packs, AND domain models (`createDocument`, `createBus`, `createDocuments`). No `class` keyword in domain code; `DocumentStore` is the last holdout (legitimate DB wrapper). Don't re-introduce `class Foo implements Bar` for domain objects.
- **Document has no top-level `elements`** — elements live per-page. Access via `doc.pages[doc.activePage].elements` or iterate `doc.pages`. The legacy proxy getter (`doc.elements → currentPage.elements`) was removed with `DocumentModel`; `Page.elements: unknown[]` is the only elements field.
- **Tool packs** — each domain (`src/tools/*.ts`) exports a `ToolPack` with `id`, `requires`, `declaresTools`, `register()`. `registerToolPacks(...)` scans `*Tool` registrations into a `toolRegistry` used by `mountTools()` **and** asserts every `declaresTools` entry appears in the registry (catches typos in Awilix keys that would otherwise skip the `endsWith("Tool")` scan). Boot additionally cross-checks the registry against `manifest.json.tools` — rename drift fails boot.
- **Shared tool output** — `packages/server/src/tools/_helpers.ts` exports `text(t, boolean | { isError?, next? })`. The `next: string[]` option renders an esac-style `next:\n  - <hint>` block — use it on business-flow hinges (e.g. `maket_charte view` already suggests `maket_html set ... context_token=...`). Don't re-implement the ToolResult envelope inline.
- **WS messages ≠ tool names** — `packages/server/src/services/ws-handler.ts` and `packages/shared/src/ws.ts` define a separate discriminated-union contract (client→server WS messages like `update_meta`, `canvas_setup`). These share names with former tools by coincidence; they're invoked by the browser UI, not by MCP. Don't rename them when renaming tools.
- **Tool rename checklist** — renaming an MCP tool touches four places: the tool file itself (incl. `declaresTools`), the `ACTIVITY_ICONS` map in `packages/server/src/routes/mcp.routes.ts`, the `tools[]` array in `manifest.json`, and the skill/doc references under `plugin/claude/**`. The registry ↔ manifest assertion (`index.ts` boot) catches three of the four if you forget — `ACTIVITY_ICONS` and plugin docs are not asserted.
- **Awilix PROXY destructure trap** — every destructured name on `deps` triggers a container lookup. Put optional test overrides on a separate `opts` arg (see `LayoutService`, `PdfService`).
- **Container self-reference** — `bootstrap.ts` registers `container: asValue(container)` so factories needing the container itself (e.g. `createMcpRouter` calling `mountTools`) can resolve it via DI.
- **SIGINT → `container.dispose()`** — closes SQLite via the store disposer; don't call `store.close()` directly.
- **`@maket/shared`** — wire contracts + invariant data both sides must agree on (`FORMATS`, `computeCanvasDims`, orientation constants). Divergent domain shapes (`Document`, `DocSummary`) stay per-side on purpose.
- **`wsRegistry.broadcast(msg: WsServerMessage)`** — accepts typed objects; JSON.stringify happens inside. Don't pre-stringify at call sites.
- **No `window.prompt` / `window.confirm`** — use `InlineNameEditor` or in-bar two-tap / `HoldToDelete` for destructive confirms.
- **Popovers inside `SidePanel` portal to `document.body`** — fixed coords from trigger's `getBoundingClientRect()`, `z-index ≥ 210` (panel is 201). Absolute positioning gets clipped by the panel's `overflow-hidden`.
- **Cross-cutting invariants apply everywhere** — `lockGuard` must gate MCP tools, `ws-handler` cases, AND bulk UI. One missed entry point = full bypass.
- **Escape user strings inside `<style>`** — CSS values via `escapeCssValue`, kill `</style` via `stripStyleClose` (`ThumbnailService` pattern).
- **Tests co-located** — `foo.ts` + `foo.test.ts`. Use `createSQLiteStore(":memory:")` for DB tests. Coverage thresholds in `vitest.config.ts` (core 90%, services 80%).

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAKET_PORT` | `24843` | HTTP server port (`.mcpb` desktop extension typically holds 24842). `start:isolated` → 3333, `e2e:server` → 3399. |
| `MAKET_TITLE` | `Maket` | App name shown in UI |
| `MAKET_DB` | `~/.maket/documents.db` | SQLite database path |
| `MAKET_DATA_DIR` | `~/.maket/` | User data (assets, docs) |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID (Gmail) |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth client secret (Gmail) |

## Gotchas

- **Bootstrapping another project** — Use `make bootstrap DIR=/path/to/project PORT=3335` to create `.mcp.json`, `.claude/skills/`, and a `package.json` with a `maket:dev` script. Never overwrites existing files.
- **Server must run first** — The MCP connects via HTTP. Start with `npm run dev` before opening Claude Code.
- **Port conflict** — Kill stale processes: `lsof -ti:24843 | xargs kill` (or `:3333` in isolated mode).
- **Tailwind v4 `@import` ordering** — `@import url(...)` MUST precede `@import "tailwindcss"` in `index.css`; Tailwind inlines its import in place, so anything after gets buried and PostCSS rejects.
- **SQLite migrations** — `store.ts` checks column existence, not version numbers.
- **Pre-commit hooks** — lefthook runs biome + typecheck + vitest. All three must pass.
- **Biome per-package** — Each package has its own `biome.json` with `root: false`, inheriting from root config.
- **npm workspaces** — Single `node_modules/` at root. Use `-w @maket/server` for package-specific commands.
- **Client rebuild** — `npm run dev` uses Vite dev server (HMR on :5173). `npm run dev:watch` uses `vite build --watch` → `public/`. Preview at `:24842` serves from `public/`, so client changes need `dev:watch` or `build:client` to take effect.
- **Immediate persistence** — Every mutation calls `persistDoc()` directly. No debounced auto-save, no dirty tracking.
- **Dev data lives in `.maket/`** — npm scripts set `MAKET_DATA_DIR="$PWD/.maket"`. Directory is gitignored.
- **Mermaid syntax** — `beautiful-mermaid` requires the header on its own line: `"graph TD\n  A-->B"`, not `"graph TD; A-->B"`.
- **gmail-client coverage exclusion** — `googleapis` calls are lazy dynamic imports; only `loadCredentials()` is unit-tested. Full flow covered at plugin level (future).
- **Biome auto-fix during refactors** — after large structural changes, `npx biome check --write packages/server/` clears formatting/import-order drift before `npm run quality`.
- **Client has `verbatimModuleSyntax: true`** (`packages/client/tsconfig.app.json`); server does not. Type-only imports must use `import type` in client code or the build fails.
- **Stale `tsconfig.tsbuildinfo`** after cross-package refactors can surface TS6310 ("Referenced project may not disable emit") or phantom errors. Reset: `rm packages/*/tsconfig.tsbuildinfo && npx tsc -b`.
- **`npm run lint` exits 0 with warnings** — only errors fail the gate. Don't chase biome warnings. `npx biome check --max-diagnostics=0` reveals all errors when the default limit truncates output.
- **macOS sed has no `\b`** — BSD sed silently ignores `\b` word boundaries. For bulk identifier renames, use plain substring substitution (unique identifiers like `mermaidPlugin → mermaidPack` are safe).
- **`coverage/` dir pollutes lint** — vitest coverage HTML triggers biome parse errors. Add `coverage` to `biome.json` `files.includes` exclusions if it becomes noisy.
