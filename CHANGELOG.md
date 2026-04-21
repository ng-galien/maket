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
