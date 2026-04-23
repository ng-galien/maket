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

[Unreleased]: https://github.com/ng-galien/maket/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/ng-galien/maket/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ng-galien/maket/releases/tag/v1.0.0
