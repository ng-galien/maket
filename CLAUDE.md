# Maket

Visual design tool for Claude — compose HTML/CSS documents with live preview, manage assets, apply brand chartes, export PDF, send via Gmail. MCP server exposed over Streamable HTTP at `POST /mcp`.

## Quickstart

```bash
npm run dev       # server --watch + Vite HMR (the one you want 95 % of the time)
npm run dev:watch # server --watch + vite build --watch → public/ (prod-like preview on :24843)
npm run quality   # lint + typecheck + test — same gate as pre-commit
npm run lint:fix  # biome check --write
```

Node `>=22`. **The server must be running before Claude Code connects** (MCP is HTTP-based). The human usually runs it themselves; don't spawn a second dev server.

## Coding principles

These aren't style preferences — they're the invariants the codebase depends on. Breaking any of them reliably breaks boot, tests, or the refactor safety net.

### Dependency injection via Awilix — no exceptions
- Every service, tool pack, and HTTP route is a **factory registered in `bootstrap.ts`**. Consumers resolve by destructured param name. No module-level singletons, no `new`, no direct imports of concrete implementations.
- **Interface first** — declare `export interface Foo { … }` above `createFoo`. Consumers type against the interface; the factory implements it.
- **Factories over classes everywhere** — no `class` keyword in domain code (`DocumentStore` is the lone exception — a legitimate DB wrapper). Private state lives in factory closures.
- **PROXY destructure trap** — every destructured name on `deps` triggers a container lookup. Put optional test overrides on a separate `opts` arg (see `LayoutService`, `PdfService`).
- **Container self-reference** — `bootstrap.ts` registers `container: asValue(container)` so factories that need the container itself (`createMcpRouter` → `mountTools`) resolve it via DI.

### Separation of concerns is hard-enforced
- If you catch yourself adding a runtime field to a persistence type (the old `Document._pending` shape), **that's a new service**. Persistence models hold persistent state; transient state gets its own home. `packages/server/src/services/pending.ts` is the template — factory + interface + private closures + bus-driven side effects.
- **No deprecation shims** — when moving state, remove the old field in the same diff and migrate every call site. "No baby-step migrations."

### Bus emits, listeners propagate
- Services mutate state and emit on the `bus`. Side effects (WS broadcast, toasts) live in `packages/server/index.ts` listeners. **A service never calls `wsRegistry.broadcast` directly.**
- `wsRegistry.broadcast(msg)` accepts typed `WsServerMessage` objects — JSON.stringify happens inside. Don't pre-stringify.

### Complete migrations, four-point checklist on tool renames
Renaming an MCP tool touches four places:
1. The tool file (incl. `declaresTools`)
2. `ACTIVITY_ICONS` in `packages/server/src/routes/mcp.routes.ts`
3. `manifest.json.tools[]`
4. Skill + doc references under `plugin/claude/**`

Boot asserts (1) ↔ (3) and fails fast on drift. (2) and (4) aren't asserted — verify manually.

### Cross-cutting invariants apply at every entry point
Gating logic like `lockGuard` must run in MCP tools, `ws-handler` cases, **AND** bulk UI flows. One missed entry = full bypass. Same for escaping user strings inside `<style>` (`escapeCssValue` + `stripStyleClose`, see `ThumbnailService`).

### Tool output
Always use `text(t, { isError?, next? })` from `packages/server/src/tools/_helpers.ts`. Never build the MCP content envelope inline. Use the `next: string[]` option on business-flow hinges so the agent sees what call to make next.

### Client mirrors server state over WS
- **Zustand = single source of truth.** No Context, no prop-drilled server state. Selectors + `useShallow` for derived shapes.
- **WS for mutations, HTTP only for binaries** (assets, `.maket` bundles). Handlers write the store directly via `useStore.getState()`.
- **Pending queue is the optimistic layer** — `addPending` enqueues, `ack_messages` settles. Don't pre-apply edits to the store.
- **Toasts are server-authored** — `spawnBubble` fires only from the `activity` WS handler.
- **Edit mode is server-authoritative** — any `state` message exits it; don't try to preserve selection across reloads.
- **No `window.prompt` / `window.confirm`** — `InlineNameEditor` for names, `HoldToDelete` or reversible `flagged-delete` for destructive.
- **Popovers inside `SidePanel` portal to `document.body`** (panel's `overflow-hidden` clips). Use `--z-popover` / `--z-modal` tokens.
- **`verbatimModuleSyntax: true`** — `import type` for types.

### Tests
- Co-located: `foo.ts` + `foo.test.ts`. DB tests use `createSQLiteStore(":memory:")` — never touch the filesystem.
- Coverage thresholds in `vitest.config.ts` (core 90 %, services 80 %).

### Gmail is draft-only, read is opt-in
- Maket never calls `users.messages.send` nor `users.drafts.send`. The user reviews in Gmail and sends themselves. No exception.
- `gmail.compose` is always requested. `gmail.readonly` is requested only when the caller passes `with_read=true` at `connect`. Guard `search` / `read` behind `gmailClient.grants().read`; on miss, return `text(…, { next: ["maket_gmail action=connect with_read=true"] })`.
- The OAuth app is unverified and stays that way — we don't pay CASA for an open-source tool. Users see Google's "Advanced → proceed" screen once; that's the deal.
- On successful draft creation, write `doc.meta.emailDraftUrl` + `emailDraftRole: "body"|"attachment"` on the body doc AND mirror both onto every attached doc, so each artefact carries a one-click review pointer back into Gmail.

## Git flow & changelog

- Feature branches only; `main` takes release commits directly (`chore(release): vX.Y.Z`).
- **One feature = one branch = one issue.** Never stack unrelated work on an existing `feat/*` branch. Each new task: open a GitHub issue, branch from `origin/main` (skip local main to avoid divergence surprises), commit, let the PR close the issue.
- No push or PR without explicit user go-ahead.
- Conventional Commits. `npm run changelog:draft` groups commits since the last tag into an `[Unreleased]` draft — paste into `CHANGELOG.md`, cut the noise.
- `CHANGELOG.md` follows Keep a Changelog 1.1.0 + a non-standard `Internal` bucket for CI/tests/cleanup.
- Internal-only branches merge without a version bump. Release = runtime change: roll `[Unreleased]` → `[X.Y.Z]`, run `npm run version:bump X.Y.Z` (rewrites root + every workspace `package.json`), tag `vX.Y.Z`.
- **Version alignment is enforced.** Root `package.json` + every `packages/*/package.json` must share the same `version`. `npm run version:check` runs inside `quality` and fails the gate on drift. Never bump a single file by hand — always `version:bump`.

## Dev flow gotchas

- **Pre-commit hooks** — lefthook runs biome + typecheck + vitest. All three must pass before a commit lands.
- **`npm run lint` exits 0 with warnings** — only errors fail the gate. Don't chase warnings. Use `npx biome check --max-diagnostics=0` when output is truncated.
- **Stale `tsconfig.tsbuildinfo`** after cross-package refactors causes TS6310 or phantom errors. Reset: `rm packages/*/tsconfig.tsbuildinfo && npx tsc -b`.
- **Biome drift after big refactors** — run `npx biome check --write packages/<x>/` before `npm run quality`.
- **Client rebuild** — `npm run dev` uses Vite HMR on :5173; `dev:watch` writes to `public/` for the :24842/24843 server preview. If you don't see your client change, you're on the wrong script.
- **Dev data lives in `.maket/`** — npm scripts set `MAKET_DATA_DIR="$PWD/.maket"` (gitignored). Clear stale servers with `lsof -ti:24843 | xargs kill`.
- **Tailwind v4 `@import` ordering** — `@import url(...)` MUST precede `@import "tailwindcss"` in `index.css`. PostCSS rejects otherwise.
- **macOS sed has no `\b`** — for bulk identifier renames, rely on unique substring substitution.

## Source-of-truth references

CLAUDE.md intentionally doesn't describe every subsystem — the code is the reference.

- **Services + DI wiring** → `packages/server/src/bootstrap.ts`
- **MCP tool surface** → `manifest.json` (names) + `packages/server/src/tools/*.ts` (behaviour)
- **WS wire contract** → `packages/shared/src/ws.ts` (WsClientMessage / WsServerMessage unions)
- **HTTP routes** → `packages/server/src/routes/*.ts` + `routes/index.ts` mount order
- **Shared invariants** (formats, canvas dims, pending message shape) → `packages/shared/src/`
- **Charte compliance + layout rules** → `packages/server/src/lib/charte-check.ts`, `services/layout.ts`
- **`.maket` bundle format** → `packages/server/src/lib/maket-format.ts`
- **Pending queue** → `packages/server/src/services/pending.ts`
- **Environment + paths** → `packages/server/src/services/config.ts`
- **Claude Code plugin (skills + commands)** → `plugin/claude/`
- **Downstream workspace scaffolding** → `make bootstrap DIR=... PORT=...` (see `Makefile`)
