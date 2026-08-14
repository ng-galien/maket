# Changelog

All notable changes to **Maket** are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Sections under a released version describe user-visible changes in the
published `@ng-galien/maket` package; internal-only work (CI, tests, dead
comment cleanup) goes under **Internal**.

Drafting help: `node scripts/changelog-draft.mjs` prints a grouped draft
from the git log since the last tag — paste into `[Unreleased]` and edit.

## [Unreleased]

## [1.7.3] — 2026-08-14

### Fixed

- Keep authored page selectors isolated from Maket's headless render frames so
  document thumbnails, print previews, PNG snapshots, and PDF exports preserve
  the same geometry across page sizes and orientations.
- Persist canvas format, orientation, and print-safe margin changes before
  broadcasting them, and advance render revision timestamps for rapid updates
  so document thumbnails cannot reuse stale dimensions.

## [1.7.2] — 2026-08-14

### Fixed

- Keep a renamed document as a single workspace instance across Canvas and
  Reader, preserving each window's focus, active page, and annotations without
  requiring a browser refresh.

## [1.7.1] — 2026-08-12

### Fixed

- Close the collection library when opening its data workspace so the panel backdrop cannot block collection editing.
- Preserve the selected upload files across the asynchronous Photos workflow so
  successful UI uploads still create the agent classification request after the
  native file input is cleared.
- Refresh document-card thumbnails when their applied charte changes, and expose
  the photo-detail delete action with an accessible name.

### Internal
- Remove unreachable browser WebSocket mutations and the superseded
  browser-to-server layout measurement round trip; canvas, asset, charte, and
  layout behavior remain owned by their active MCP and server boundaries.
- **Playwright now reports product coverage from real browser workflows.** Each
  connected test gets isolated server state, while the existing Chromium run
  produces separate source-mapped client and server baselines as CI artifacts.
  The reports are informational until targeted thresholds are stabilized; the
  existing Vitest coverage gate remains unchanged.
- Agent-driven Playwright journeys now exercise live MCP document/page
  composition, collection rendering and cursors, document-state revisions, and
  portable bundle restoration. Coverage includes a historical v1 import plus
  separate v2 round-trips for collection-backed and state-backed documents.
- Public browser coverage now also exercises human upload through agent image
  inspection and document insertion, charte enforcement and compliant rendering,
  print/PNG/PDF output, and press-and-hold deletion safety.
- Browser execution of shared runtime sources is merged into the server/shared
  E2E report, so compatibility code used by the UI is no longer reported as
  untouched merely because it did not execute in the Node process.
- Asset deletion now covers the real hold interaction and cross-window WS
  refresh; historical string-form charte rules are imported, displayed and
  modernized; document thumbnails are rendered and refreshed after live charte
  changes.

## [1.7.0] — 2026-08-11

### Added
- **Persistent document annotations.** Notes and element requests are stored in
  SQLite, synchronized across browser windows, and included when `.maket`
  bundles are exported and imported. Existing bundles and older clients remain
  readable; clients that do not support annotations simply ignore them.

### Changed
- **The Exchanges panel makes requests easier to act on.** Notes now expose
  their document and page context, can open a document before locating their
  target, and use clearer, accessible View and Resolve actions with visible
  document- and element-level markers.
- **Reader navigation is quieter and easier to scan.** The oversized native
  document selector is replaced by a compact, keyboard-accessible menu, while
  document and page controls use balanced groups across desktop and mobile.

### Fixed
- **Annotation actions no longer disappear before persistence is confirmed.**
  Note and image requests wait for a correlated server acknowledgement, retain
  user input when saving fails, and report connection or persistence errors.

### Internal
- **Pull requests now exercise real browser workflows.** CI runs the same
  coverage-enforced quality contract as local development and a separate
  Playwright suite in Chromium. Installable-package smoke tests remain a
  release gate.
- **Coverage badge publication no longer participates in pull-request CI.** A
  separate write-scoped workflow consumes the validated artifact only after a
  successful CI push to `main`, so pull-request runs terminate normally and
  remain read-only.

## [1.6.0] — 2026-08-09

### Added
- **Continuous reading mode.** The focused document can now be read as a
  centered vertical sequence of pages with responsive width, native scrolling,
  compact page navigation, keyboard shortcuts, and a locally persisted view
  preference. The existing page renderer remains live and editable in both
  light and dark themes.

### Changed
- **Reading stays focused and unobtrusive.** Entering reading mode closes
  workspace panels, clears activity bubbles, suppresses new background
  activity overlays, and reserves space for the movable toolbar. Explicit
  document selections still navigate immediately, including documents already
  open in the workspace.

### Fixed
- **Automatic canvas focus returns to the intended page.** Leaving reading
  mode, loading or removing documents, changing pages, and resizing the
  workspace now share a deferred layout-aware recentering path. React
  StrictMode, background agent focus changes, and interrupted D3 transitions
  no longer displace the reader or override a user zoom.

## [1.5.1] — 2026-08-08

### Added
- **Hierarchical document categories and assisted search.** Slash-separated
  category paths now render as a compact tree in both list and grid views,
  while the document search offers keyboard-accessible suggestions for
  categories, lock state, and ratings without hiding results for an incomplete
  token. Existing flat categories remain compatible without a database
  migration.

### Changed
- **The Documents panel is leaner and resizable.** Category rows browse and
  collapse the tree instead of applying an implicit filter, list metadata and
  bottom controls use less space, and single or bulk moves accept hierarchical
  category paths.

### Fixed
- **Living-document enum menus stay readable while the canvas is zoomed.**
  State-bound selects open an accessible screen-sized listbox constrained to
  the viewport, preserve server-authoritative pending behavior, follow their
  anchor while the canvas moves, and restore predictable keyboard focus.

## [1.5.0] — 2026-08-07

### Added
- **Living document state.** Documents can own a JSON Schema and validated
  current data, expose native HTML controls through `data-maket-bind`, and be
  updated by people or agents through revision-checked patches. Immutable local
  revisions preserve the audit trail while `maket_state` exposes the workflow
  to MCP clients.
- **Portable living documents.** `.maket` bundles now carry the current state
  schema and snapshot alongside documents, chartes, collections, and assets.
  Importing a bundle starts a fresh local revision history instead of copying
  the source history.
- **Living-document starter and demo.** The project site, interactive demo, and
  downloadable starter now show a complete state-backed checklist workflow.

### Changed
- **Read-only viewers keep controls explorable.** Checkboxes and selects remain
  locally interactive in demos and standalone viewers without persisting or
  sending state mutations.
- **Global client configuration is location-safe.** Codex, Claude, and Gemini
  registrations use the resolved Node runtime and installed Maket entry point,
  so GUI clients no longer depend on their shell `PATH`.
- **Installation diagnostics cover the full runtime.** Fresh-package checks now
  prove the installed CLI, MCP tools, headless Chromium, client configuration,
  and living-document guidance before publication.

### Fixed
- **Layout validation catches preserved and clipped content.** Long or
  constrained `<pre>` blocks, internal clipping, margins, overlaps, and browser
  failures now produce reliable verdicts. Intentional leaf decorations can be
  excluded only through the narrowly validated
  `data-maket-layout="ignore"` marker.
- **SQLite migrations preserve existing work.** Historical and partially
  migrated databases are repaired transactionally; unsupported or newer
  schemas fail safely instead of being rebuilt destructively.
- **Gmail authentication recovers cleanly.** Expired access tokens are refreshed
  once after an authorization failure, while diagnostics time out instead of
  hanging on an unavailable OAuth endpoint.

### Internal
- Updated Node dependencies and CI actions, moved generated GitHub Pages assets
  into the deployment workflow, and removed obsolete checked-in site artifacts.

## [1.4.5] — 2026-08-04

### Added
- **Standalone viewer and interactive demo.** Local `.maket` bundles can be
  explored in a responsive, multi-page read-only viewer, with starter documents
  and guided scenarios available from the project site.
- **Shared collection preview cursors.** A page bound to a collection now has a
  server-owned preview mode and row selection shared by the browser, MCP tools,
  and exports.

### Changed
- **Data sources live in the document toolbar.** Collection controls now stay
  close to the active page instead of occupying a separate workspace panel.
- **WebSocket propagation follows the service bus.** Server-side mutations emit
  domain events and a single integration layer fans state out to browsers.

### Fixed
- **Documents and edits refresh immediately.** Creating the first document in an
  empty workspace, replacing HTML, patching HTML, and applying chartes now update
  the live canvas without requiring a page reload.
- **Activity feedback is exhaustive and never empty.** Visible MCP activities
  have typed, translated messages; intentional reads stay silent, failed tools
  do not display success bubbles, and unknown activity contracts fail loudly.
- **Collection cursor feedback matches the operation.** Cursor reads are silent
  while mutations display a correctly labelled activity without confusing the
  document name for a collection name.
- **Project-site social previews use the Maket identity.** Shared previews no
  longer fall back to the previous placeholder artwork.

### Internal
- Added executable Code Moniker architecture invariants and split large document
  and WebSocket handlers into focused modules.

## [1.4.4] — 2026-07-26

### Added
- **Official MCP Registry metadata.** Maket now publishes a verified
  `io.github.ng-galien/maket` identity and a `server.json` descriptor for its
  npm package and stdio transport, making the server ready for listing in the
  official MCP Registry.

### Changed
- **Release metadata stays aligned automatically.** Version bumps and quality
  checks now keep the npm package, workspaces, and MCP Registry descriptor on
  the same version.
- **Typed data collections are documented in the packaged README.** Installation
  and feature discovery now explain how one template can render a validated
  series of document variants from ordered data rows.

## [1.4.3] — 2026-07-13

### Fixed
- **Headless renders complete reliably on recent macOS.** Snapshots, layout
  checks, thumbnails, and PDF exports now use `chrome-headless-shell`, avoiding
  the `Page.captureScreenshot` stall seen with unified headless Chrome.

## [1.4.2] — 2026-07-12

### Fixed
- **Collection previews work in the packaged application.** The local Content
  Security Policy now permits Ajv's schema-validation compilation without
  allowing inline scripts, preventing false placeholder errors after edits.

## [1.4.1] — 2026-07-12

### Fixed
- **Dataset previews survive document layout refreshes.** Editing a document
  bound to a collection no longer temporarily drops its dataset and shows a
  false “Collection not found” error until the browser is reloaded.

## [1.4.0] — 2026-06-26

### Added
- **Typed collections and document placeholders.** Collections are now first-class
  resources with JSON Schema metadata and ordered rows. Pages can be bound to a
  collection and render placeholder-driven variants from the current row or from
  the full collection.
- **Collection editing workflow in the UI and MCP.** The workspace exposes
  collection data beside documents, with row insertion/update/delete, schema
  changes, validation feedback, paste-oriented data editing, and print preview
  modes that follow the active collection selection.
- **Agent onboarding via `maket_learn`.** New MCP tool that gives Claude, Codex,
  and Gemini agents live Maket operating guidance: workflow, HTML composition,
  chartes, collections, review loop, and client install notes.
- **User Help document.** The bottom toolbar now includes a Help button that
  opens a built-in, localized onboarding document in the workspace without
  mixing it with agent-facing `maket_learn` content.
- **Gemini CLI install support.** `maket install gemini --apply` and
  `maket uninstall gemini --apply` manage the `~/.gemini/settings.json` MCP
  server entry. Thin Codex/Gemini orientation files now point agents to
  `maket_learn`.

### Changed
- **WebSocket contract boundaries clarified.** Shared WS types keep command and
  signal direction explicit while preserving the complete union for dispatching.
- **Document/server responsibilities split.** Persistence, asset concerns, page
  identity, and workspace contracts were extracted back into clearer services
  instead of being carried by document objects or ad-hoc helpers.
- **Maket skills are now orientation-only.** Product knowledge moved out of the
  bulky Claude skill and into the MCP `maket_learn` source of truth.

### Fixed
- **Workspace message schema is stricter.** Pending/user-message retrieval now
  uses the intended Zod contract.
- **Client list rendering avoids array-index keys** in newly touched flows,
  preserving stable React identity during row/document changes.

### Internal
- **Code-moniker quality gate.** Structural smell rules and architecture
  boundary checks now run through `npm run quality`; the current gate reports
  zero violations.
- Cleaned code-smell follow-ups around item action contracts, client
  deduplication, page identity migration, and server responsibility boundaries.

## [1.3.0] — 2026-05-03

### Added
- **`.maket` bundle v2: portable export with embedded assets** (#12).
  `maket_doc action=export` (and `GET /api/export-maket`) now default to a
  ZIP container carrying `manifest.json` + `assets/*`, so a bundle
  transferred to another machine or a fresh datadir keeps its images.
  Pass `include_assets=false` for the previous structure-only snapshot
  (lighter, git-friendly). Old v1 gzip-JSON bundles continue to import —
  `decodeBundle` dispatches by magic bytes (`1f8b` → v1, `504b0304` →
  v2). Path-traversal protection drops ZIP entries that escape `assets/`.

### Changed
- **Symmetric metadata wire contract** (#18). The three partial-update
  WS verbs (`update_meta` for docs, `update_charte_meta`, `update_asset_meta`)
  now share one rule: only `undefined` preserves; `""` / `[]` clear.
  Previously, sending an empty string to clear an asset's title silently
  collapsed to NULL and the SQL UPSERT preserved the prior value — there
  was no way to clear a stored field without round-tripping through
  delete + re-import (#19). The metadata.json sidecar that the
  v6→sql migration left behind is also removed on the read path; only
  the SQL row is consulted.

### Fixed
- **Security: agent-authored HTML can no longer exfiltrate via Google Fonts**
  (#5). The puppeteer network guard previously admitted any URL on
  `fonts.googleapis.com` / `fonts.gstatic.com` on the assumption that
  the URL came from a static charte token — true for `charteFontImport`,
  but the same render path also processes agent-authored HTML, so a
  prompt-injected `<link href="…?family=Inter&leak={{secret}}">` would
  round-trip the secret through Google's access logs. Tightened to a
  path + query-key allowlist (`/css|/css2`, keys
  `family|display|subset|text|effect`; gstatic only `/s/...` with no
  query). Charte font tokens are validated against `[A-Za-z0-9 -]+`
  before being spliced into the `@import` URL.

## [1.2.0] — 2026-04-25

### Changed
- **Layout verdict** is now a three-axis check (`✓ ok` / `⚠ tight` / `⛔ overflow`).
  `tight` measures every `[data-id]` block against the canvas's declared
  `margins` (per-side mm), no longer a hidden heuristic. `overflow` covers
  canvas escape AND pairwise block intersection (`overlap`), surfaced
  with a distinct headline (e.g. `Layout overlap — not shippable`).
- **Canvas `textMargin: number` → `margins: {top, right, bottom, left}`.**
  `maket_canvas` and `maket_doc new` accept the new per-side object;
  legacy persisted docs migrate automatically on load — `textMargin: N`
  becomes symmetric per-side margins, the legacy field is dropped.
- **Live preview safe-zone guide** redrawn from the new per-side margins
  and bumped from a 0.5px / 0.3 alpha hairline to 1px / 0.7 alpha so the
  cyan dashed rectangle is actually readable as a print reference.

### Added
- **`maket_html check`** now reports overlap + tight per-side, and the
  `next:` block bundles `overflowIds + overlapIds + tightIds` into the
  patch hint.
- **`docs/layout.md`** — user-facing guide explaining the safe-zone in
  the live preview, margin presets per use case (poster, paperback,
  magazine, office doc) with public sources, and natural-language
  prompts to ask the assistant to check and correct the layout.
- **`maket_gmail action=fetch_attachment`** for retrieving Gmail
  attachments (closes #9).
- **Inline brand-guide editor** — modal + color picker + live refresh
  for chartes (#4).
- **CLI overhaul** — `maket doctor / update / restart / uninstall /
  config`; cac-based argument parsing (#11).

### Fixed
- **Browser tab favicon.** Replaced the placeholder purple SVG (heavy
  filters/masks that didn't render at favicon sizes) with the
  maket-blueprint identity — navy (`#0D1B2A`) + serif "M." + cyan
  (`#00A8B5`) accent dot, matching the marketing site.
- **Headless layout measurement** — `fonts.ready` alone wasn't enough;
  unloaded `<img>` reported `naturalHeight=0` and the walker silently
  agreed the page fit. New `lib/page-stable-wait.ts` helper runs
  `fonts.ready` + `image.decode()` in parallel then `rAF×2`, reused by
  `pdf.ts`, `thumbnail.ts`, `tools/preview.ts`, `services/layout.ts`
  for a single stability contract.
- **Headless root pick** — uses the canonical `[data-id="page"]`
  selector with `firstElementChild` as fallback, instead of blindly
  picking the first child (which broke when user HTML started with
  `<style>` or a comment).
- **Tight tolerance** symmetric ±2px (was asymmetric `top<-1` /
  `bottom>h+1`, causing flicker at the boundary).
- **Headless-unavailable** verdict now surfaces the caveat in the text
  instead of silently falling back to the mm-math result.

### Internal
- Dropped `packages/client/public/icons.svg` — stale Vite-template
  social-icon sprite, zero references in the codebase.

## [1.1.0] — 2026-04-23

### Changed
- `maket_gmail` is now draft-only: Maket never calls any send endpoint.
  `action=draft` returns a `#drafts/<message-id>` deep link that the user
  clicks to review and send from Gmail themselves.
- Gmail consent splits into two tiers at connect time. Default asks only
  for `gmail.compose` ("Manage drafts and send emails") — the "Read your
  Gmail" prompt is gone. Pass `action=connect with_read=true` to additionally
  request `gmail.readonly` for `search` / `read`. When those actions are
  called without the read grant, the tool returns an MCP `next:` hint that
  walks the agent through the re-authorise flow.
- Doc metadata gains `emailDraftUrl` + `emailDraftRole: "body"|"attachment"`.
  On draft creation the URL is written to the body doc and mirrored onto
  every attached doc, so each artefact carries a one-click review pointer
  back into Gmail.

### Added
- A discreet **Draft ready / In draft** indicator in the sidebar (both list
  and grid views) and in the Board doc label — leading cyan dot, trailing
  external-link glyph, opens the Gmail draft in a new tab.
- **SVG asset support.** `maket_image view` and the HTTP `/assets/thumb|preview`
  route now rasterize SVGs to PNG via resvg-js (WASM). The vector source
  stays on disk; a `<file>.thumb.png` sibling is generated on import and
  served to both the vision model and the client asset grid. Fixes the
  "Could not process image" 400 that hit every SVG view call before, and
  silences the per-request Jimp error the UI thumb route was emitting on
  every SVG tile.

### Fixed
- **Thumbnail pipeline** (PR #6) — a cluster of bugs around `assets/thumbs/`:
  `maket_image view` was looking up thumbs under the source extension while
  the writer always produced `.jpg`, so `.png`/`.webp`/`.gif` silently fell
  back to the full-size image (naive MCP clients blew their stack on the
  multi-MB base64 blob); `logo.png` and `logo.jpg` shared a single thumb
  (collision); `delete` left orphan thumbs on disk; and the legacy-thumb
  migration produced false positives on basenames ending in `.thumb`. Naming
  is now `<source-filename>.thumb.<ext>` with a one-shot, idempotent,
  case-aware, race-safe migration at boot (with counters).
- **WebSocket `delete_asset`** routes through `assets.remove` like the MCP
  tool, so UI deletes clean up thumbnails and DB rows the same way.
- **SVG safety guard relaxed.** Empty `<foreignObject/>` tags (emitted by
  Illustrator, Inkscape, and Wikipedia as flow/extension placeholders) are
  no longer rejected. Non-empty `<foreignObject>`, `<script>`, `on*=`
  handlers, and `javascript:` URLs stay blocked.
- **Unsupported image formats** now fail `maket_image import` with a clear
  supported-list message (derived from `IMAGE_EXTS`, so it can't drift)
  instead of silently passing validation and blowing up later.
- **Charte web fonts** are now loaded in headless PDF/image renders (PR #3),
  so layout-check measurements match the live preview.

### Internal
- CI now runs the full test suite with coverage (v8 provider) on every push
  and pull-request. A shields.io-compatible badge is regenerated on every
  main-branch run and auto-committed to `.github/badges/coverage.json`; the
  markdown summary appears on each workflow run.
- Coverage thresholds enforced at the root vitest project
  (80% lines / 80% functions / 78% statements / 63% branches).
- `packages/server/tests/helpers.ts` introduces `startTestApp(app)`, replacing
  repeated `app.listen(0)` + `AddressInfo` boilerplate across seven route
  test suites.
- New test suites for the app / assets / mcp / oauth / thumbnail routes and
  for the `charte-check`, `chromium-sandbox`, `page-network-guard` libs.
- Expanded coverage on `ws-handler`, `PageCanvas`, and the html / preview /
  export / layout / thumbnail tool surfaces.
- The client package is now part of `npm run typecheck` and therefore of the
  `quality` gate.
- `packages/client/src/test-setup.ts` now imports `i18n/useT` only after the
  `localStorage` shim is installed, so Node 22's experimental webstorage
  stub never gets touched during module init.
- Added `@types/d3-transition` so `Board.tsx` can use `Selection.transition()`
  without `as any` suppressions.
- Removed dead `biome-ignore` suppressions across ~17 files (Biome no longer
  flags these `any` casts — the suppressions were noise).
- Landing page (GH Pages) rewritten in a sober editorial register, EN + FR.

## [1.0.1] — 2026-04-21

### Security
- Server was binding to `0.0.0.0` with no Origin/Host gate and WebSocket
  accepted any origin. Tightened to localhost-only with origin validation
  (commit `d13ce01`).
- Closed a render-channel data-exfiltration path via puppeteer + screenshot
  + loopback fetch, an SSRF redirect bypass, a body-size DoS vector, and
  scoped MCP tool filesystem access (commit `7b8d08c`).
- `stripActiveHtml` is now applied on every `page.html` write, not only at
  paste time (commit `d14fd31`).

### Fixed
- v1.0.0 binary failed to spawn its server when installed via npm because
  the sibling `server.js` lookup was POSIX-only. Dropped POSIX assumptions
  from the CLI and `pack-npm` (commit `081e2d2`, `cdb8a35`).
- CI: pin npm to 11.5.1 with `--force` to dodge self-update corruption
  (commit `4e8d798`).

## [1.0.0] — 2026-04-19

Initial public release.

- MCP server (Express + Streamable HTTP + WebSocket) that lets an AI
  assistant compose HTML/CSS documents with live preview.
- React 19 + Vite + Tailwind client with canvas-style editing, asset
  library, brand chartes, pending-message queue.
- PDF export via puppeteer, Gmail send via OAuth, `.maket` bundle
  import/export.
- Monorepo (`@maket/server`, `@maket/client`, `@maket/shared`,
  `@maket/stdio-bridge`) shipped as `@ng-galien/maket` on npm via OIDC
  trusted publishing.

[Unreleased]: https://github.com/ng-galien/maket/compare/v1.4.5...HEAD
[1.4.5]: https://github.com/ng-galien/maket/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/ng-galien/maket/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/ng-galien/maket/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/ng-galien/maket/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/ng-galien/maket/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/ng-galien/maket/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/ng-galien/maket/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/ng-galien/maket/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/ng-galien/maket/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/ng-galien/maket/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ng-galien/maket/releases/tag/v1.0.0
