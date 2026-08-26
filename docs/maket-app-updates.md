# Maket App updates

`maket` remains the server and CLI package. `maket-app` is the Electron distribution; the visible product name remains **Maket**.

## Release channels

- **Stable** consumes non-draft, non-prerelease GitHub Releases through Electron's public update service. A stable release must contain the macOS ZIP and the Windows Squirrel assets (`Setup.exe`, `RELEASES`, and the full `.nupkg`).
- **Candidate** consumes a dedicated static feed under `https://ng-galien.github.io/maket/updates/candidate/{platform}/{arch}`. Release candidates use SemVer versions such as `2.0.0-rc.1` and are published as GitHub prereleases.
- **Snapshot** is an unsigned, local-install build of every push to `main`. GitHub Actions retains the macOS Intel, macOS Apple Silicon, Windows x64, and Linux x64 artifacts for 14 days. The local-install marker disables public update checks so a snapshot cannot accidentally move onto a release channel.

The public Electron service intentionally excludes GitHub prereleases. The candidate feed is therefore a separate distribution surface, not a compatibility alias for the stable feed. On Windows, the Squirrel `RELEASES` file and referenced `.nupkg` are deployed together under the candidate feed URL.

## Application behavior

The selected channel is persisted in the Electron user-data directory. Maket App checks on startup and then hourly. The renderer receives only a small state contract:

- channel and installed version;
- checking, downloading, ready, up-to-date, or error status;
- target version when Electron provides it;
- optional numeric progress for a future updater implementation.

Electron's built-in updater does not expose byte download progress. The current UI therefore uses an indeterminate thin progress line and spinner while downloading. Once the update is ready, the user can restart from Settings; Maket stops its embedded server before `quitAndInstall()`.

Local and CI installers use the same pipeline: `npm run desktop -- make --arch=<arch>`. Add `--local-install` for a local test installer; this only adds the `local-install` marker that disables public update checks. Packaging requires the Node major declared in `.desktop-node-version` (currently Node 22) and fails immediately on other Node majors; `npm run desktop -- check` diagnoses the active runtime. Snapshot CI adds the local marker; candidate and stable release builds omit it and keep automatic updates enabled.

This packaging constraint is deliberately separate from the general `node >=22` project engine. It must not become permanent by accident: when Forge and its makers are upgraded, change `.desktop-node-version` in the same pull request, then validate macOS arm64/x64, Windows x64, and Linux x64 installers plus one update from the previous candidate. The guard, CI, and documentation will all follow that single change.

An unreachable or incomplete release feed is reported as neutral `unavailable` state in Settings. It never creates an error badge in the application rail; Maket retries through the normal update loop. The red error state is reserved for an internal application failure, not network or release-service availability.

## Publishing

`desktop-snapshot.yml` runs on every push to `main` and can also be dispatched manually. Its four unsigned artifacts are the inspection surface before a release; they are not attached to a GitHub Release and are not a substitute for signing validation.

The existing `publish.yml` workflow remains responsible for the npm/MCP package and the GitHub Release. A version tag first passes a preflight that checks its version, ancestry on `main`, changelog section, and the presence of every signing credential. The desktop matrix must then finish signed installers for macOS Intel, macOS Apple Silicon, and Windows x64 plus unsigned Linux x64 DEB and RPM packages. Only after all four builds succeed may the workflow publish npm, publish the MCP Registry entry, and create the GitHub Release; a final job attaches the already-built installers. This ordering prevents a missing certificate or broken desktop package from leaving a registry-only release.

Prerelease packages use the npm `next` tag and GitHub prerelease classification. For prereleases, a final job generates the macOS and Windows updater metadata, deploys the candidate feed through GitHub Pages, and preserves that feed across later documentation deployments. Linux updates remain manual. The manual `workflow_dispatch` path is only a registry catch-up from `main`; it does not create a release, build installers, or require signing credentials.

Each build keeps the Forge filenames needed by the update services and adds stable, version-independent names for human downloads:

- `Maket-macOS-arm64.dmg` and `Maket-macOS-x64.dmg`;
- `Maket-Windows-x64-Setup.exe`;
- `Maket-Linux-x64.deb` and `Maket-Linux-x64.rpm`.

The README names these files and links to the latest release without predicting that an asset already exists. The website resolves the canonical names against GitHub's latest-release API: it exposes direct downloads only for assets actually present and otherwise keeps the snapshot workflow as a working fallback. Each platform also publishes a manifest and its own SHA-256 checksum file, avoiding cross-platform overwrite while jobs upload in parallel.

Required GitHub Actions secrets:

- `MACOS_CERTIFICATE` and `MACOS_CERTIFICATE_PASSWORD` for the base64 PKCS#12 Developer ID certificate;
- `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` for notarization;
- `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` for the base64 PFX certificate.

The preflight validates that these credentials are configured before any packaging or publication and fails with the exact missing secret. The platform jobs then import and exercise the certificates while building. A stable or candidate tag must not be pushed until all macOS and Windows signing credentials are configured and the snapshot installers have been inspected.

The same entry point exposes `npm run desktop -- publish` for a manually reviewed draft release. CI uses `npm run desktop -- make` followed by an explicit upload so all platform artifacts converge on one release.

## Release-candidate rollout

1. Align all workspace versions to `X.Y.Z-rc.N`, prepare that changelog section, configure every signing secret, and inspect the latest four-platform snapshot.
2. Create and push `vX.Y.Z-rc.N`; preflight validates the tag and release contract without publishing anything.
3. CI builds, signs and notarizes the macOS and Windows installers and builds the Linux DEB and RPM packages. Any failure stops the release before registry publication.
4. CI publishes npm on `next`, publishes the MCP Registry entry, creates the GitHub prerelease, and attaches the already-built installers.
5. CI deploys the Squirrel update assets and macOS `RELEASES.json` into the candidate static feed.
6. Verify the three public feed endpoints and manually install all five canonical downloads. From RC2 onward, test an update from the previous candidate on macOS and Windows before promotion.
7. Publish `vX.Y.Z` as a normal release; stable clients will then discover it through the public Electron service.
