# Maket

Visual design tool for Codex: compose HTML/CSS documents with live preview, manage assets and brand chartes, export PDF, and prepare Gmail drafts. The MCP server uses Streamable HTTP at `POST /mcp`.

## Working contract

- Treat the current checkout and executable contracts as the source of truth. Inspect before changing; preserve unrelated work and persistent data.
- Keep one coherent contract per change. Complete migrations in the same diff: update every entry point, remove the obsolete path, and do not add deprecation shims.
- Persistence types contain persistent state only. Transient state belongs in a dedicated service; `packages/server/src/services/pending.ts` is the reference pattern.
- Test user-visible workflows at their public boundary. Keep lower-level tests only when they protect a distinct validation, security, wire-format, or deterministic domain contract.

## Commands and quality gates

```bash
npm run dev       # server --watch + Vite HMR; normal development path
npm run dev:watch # server --watch + Vite build --watch into public/
npm run quality   # lint + smell review + typecheck + tests + version alignment
npm run lint:fix  # Biome autofix
```

Node `>=22`. The server must already be running before Codex connects; the human normally owns that process, so do not start a second development server.

- `npm run quality` is the required local gate before review and again after addressing findings.
- The pre-commit hook runs staged Biome fixes, typecheck, and tests in parallel. It is a commit guard, not a substitute for `quality`.
- Tests are co-located (`foo.ts` + `foo.test.ts`). Database tests use `createSQLiteStore(":memory:")`; never use the filesystem.
- Coverage configuration lives in `packages/server/vitest.config.ts` and `packages/client/vitest.config.ts`.
- Run commands that require npm registry access, global installation, loopback listeners, or Chromium outside the sandbox from the outset. In particular, request escalation directly for `npm install`, `npm install -g`, `npm run test:package`, package-install smoke tests, `npm run quality`, and `maket start`/`maket doctor`; do not first retry these known-incompatible commands inside the sandbox. Use an isolated writable cache such as `npm_config_cache=/private/tmp/maket-npm-cache` instead of the user npm cache when it contains root-owned files.

## Architecture boundaries

- **Server composition and DI** → `packages/server/src/bootstrap.ts`
- **Public MCP surface** → `manifest.json`, `packages/server/src/tools/`, `packages/server/src/core/activity-contract.ts`
- **Public HTTP surface** → `packages/server/src/routes/` and its mount order in `routes/index.ts`
- **WS wire contract and shared formats** → `packages/shared/src/`
- **Client state boundary** → Zustand store and WS handlers under `packages/client/src/`

### Server and dependency injection

- Services, tool packs, and HTTP routes are factories registered in `bootstrap.ts`. Concrete factories are wired there; consumers depend on injected interfaces by destructured parameter name.
- Declare the public interface above `createFoo`, and keep private state in the factory closure. A private class is acceptable only as a focused implementation detail or typed error; it must not become a singleton or bypass DI.
- Awilix uses PROXY injection: every destructured `deps` name triggers a lookup. Put optional test overrides in a separate `opts` argument, as in `LayoutService` and `PdfService`.
- `bootstrap.ts` registers the container itself for composition code such as `createMcpRouter` → `mountTools`; do not resolve it ad hoc elsewhere.
- Services mutate state and emit on the bus. WS broadcasts, toasts, and other propagation live in listeners in `packages/server/index.ts`; services never call `wsRegistry.broadcast` directly.

### Public entry points

- Cross-cutting guards must cover MCP tools, WS handlers, and bulk UI flows. Apply the same rule to lock checks and to user-controlled CSS escaping (`escapeCssValue` + `stripStyleClose`).
- MCP tools return `text(t, { isError?, next? })` from `packages/server/src/tools/_helpers.ts`; never hand-build the content envelope.
- Renaming or adding a tool requires one coherent update to its tool declaration, `ACTIVITY_POLICIES`, `manifest.json.tools[]`, and references under `plugin/Codex/`. Boot checks the executable contracts; plugin references still require manual verification.

### Client state

- Zustand is the client source of truth. Server state arrives through WS; HTTP is reserved for binaries such as assets and `.maket` bundles.
- The pending queue is the optimistic boundary: enqueue with `addPending`, settle through `ack_messages`, and do not pre-apply edits to the store.
- Activity toasts and edit-mode resets are server-authored. Keep destructive flows reversible or explicit; do not use `window.prompt` or `window.confirm`.

### Product safety

- Gmail is draft-only. Never call `users.messages.send` or `users.drafts.send`; the user reviews and sends in Gmail.
- Request `gmail.compose` by default and `gmail.readonly` only for `connect with_read=true`. Guard reads with `gmailClient.grants().read` and return the reconnect action through `next` when absent.
- After draft creation, persist the Gmail review URL and role on the body document and mirror them onto every attached document.

## Delivery workflow

- One feature = one issue = one branch. Start from `origin/main`; never stack unrelated work on an existing feature branch.
- Implement the complete change, add relevant public-boundary coverage, and run `npm run quality`.
- Before any push, ask one independent agent for a read-only review. Address every actionable finding, rerun the gate, then ask the same reviewer to review the updated diff. Push only when that second pass reports no remaining finding.
- Use `gh` for GitHub issues, pull requests, checks, and merges, not the GitHub app integration.
- No push or PR without explicit user approval. Use Conventional Commits and let the PR close its issue.
- Merge only with green CI. Internal-only changes need no version bump; runtime releases use `npm run version:bump X.Y.Z`, keep every workspace version aligned, update the changelog, and tag `vX.Y.Z`.
- After the merge is confirmed, close the delivery cycle: preserve any local work, switch back to `main`, fetch the remote, and fast-forward `main` to `origin/main`. Do not leave the checkout on the merged feature branch.

## Review rules

- Lead with concrete findings: defect or risk, affected public behavior, and exact location. Do not request churn for formatting already enforced by tooling.
- Judge coverage by observable boundaries such as MCP, HTTP, WS, bundle export/import, or the installable artifact. Internal-only tests do not prove those contracts; remove them when integration coverage makes them genuinely redundant.
- For migrations and cross-cutting behavior, verify every entry point and reject parallel legacy paths, duplicate orchestration, or silent contract drift.
- If there are no findings, say so explicitly and state what was tested and what remains unverified.

## Operational references

- `.maket` bundle format → `packages/server/src/lib/maket-format.ts`
- Pending queue → `packages/server/src/services/pending.ts`
- Environment and data paths → `packages/server/src/services/config.ts`
- Charte and layout rules → `packages/server/src/lib/charte-check.ts`, `packages/server/src/services/layout.ts`
- Codex plugin surface → `plugin/Codex/`
- Workspace scaffolding → `make bootstrap DIR=... PORT=...` and `Makefile`
- Stale TypeScript build state after cross-package changes → remove `packages/*/tsconfig.tsbuildinfo`, then run `npx tsc -b`
- Client preview mismatch → `npm run dev` serves Vite HMR on `:5173`; `dev:watch` writes the production-like client used by the server preview.
