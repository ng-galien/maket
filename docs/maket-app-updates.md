# Maket App updates

`maket` remains the server and CLI package. `maket-app` is the Electron distribution; the visible product name remains **Maket**.

## Release channels

- **Stable** consumes non-draft, non-prerelease GitHub Releases through Electron's public update service. A stable release must contain the macOS ZIP and the Windows Squirrel assets (`Setup.exe`, `RELEASES`, and the full `.nupkg`).
- **Candidate** consumes a dedicated static feed under `https://ng-galien.github.io/maket/updates/candidate/{platform}/{arch}`. Release candidates use SemVer versions such as `2.0.0-rc.1` and are published as GitHub prereleases.

The public Electron service intentionally excludes GitHub prereleases. The candidate feed is therefore a separate distribution surface, not a compatibility alias for the stable feed. On Windows, the Squirrel `RELEASES` file and referenced `.nupkg` are deployed together under the candidate feed URL.

## Application behavior

The selected channel is persisted in the Electron user-data directory. Maket App checks on startup and then hourly. The renderer receives only a small state contract:

- channel and installed version;
- checking, downloading, ready, up-to-date, or error status;
- target version when Electron provides it;
- optional numeric progress for a future updater implementation.

Electron's built-in updater does not expose byte download progress. The current UI therefore uses an indeterminate thin progress line and spinner while downloading. Once the update is ready, the user can restart from Settings; Maket stops its embedded server before `quitAndInstall()`.

Local and CI installers use the same pipeline: `npm run desktop -- make --arch=<arch>`. Add `--local-install` for a local test installer; this only adds the `local-install` marker that disables public update checks. Packaging requires the Node major declared in `.desktop-node-version` (currently Node 22) and fails immediately on other Node majors; `npm run desktop -- check` diagnoses the active runtime. CI and release builds omit the local marker and keep automatic updates enabled.

This packaging constraint is deliberately separate from the general `node >=22` project engine. It must not become permanent by accident: when Forge and its makers are upgraded, change `.desktop-node-version` in the same pull request, then validate macOS arm64/x64 and Windows x64 installers plus one update from the previous candidate. The guard, CI, and documentation will all follow that single change.

An unreachable or incomplete release feed is reported as neutral `unavailable` state in Settings. It never creates an error badge in the application rail; Maket retries through the normal update loop. The red error state is reserved for an internal application failure, not network or release-service availability.

## Publishing

The existing `publish.yml` workflow remains responsible for the npm/MCP package and the GitHub Release. Prerelease packages use the npm `next` tag and GitHub prerelease classification. After that release exists, the desktop matrix builds signed installers for macOS Intel, macOS Apple Silicon, and Windows x64, then attaches them to the same GitHub Release. For prereleases, a final job generates the macOS and Windows updater metadata, deploys the candidate feed through GitHub Pages, and preserves that feed across later documentation deployments.

Required GitHub Actions secrets:

- `MACOS_CERTIFICATE` and `MACOS_CERTIFICATE_PASSWORD` for the base64 PKCS#12 Developer ID certificate;
- `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` for notarization;
- `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` for the base64 PFX certificate.

The same entry point exposes `npm run desktop -- publish` for a manually reviewed draft release. CI uses `npm run desktop -- make` followed by an explicit upload so all platform artifacts converge on one release.

## Release-candidate rollout

1. Align all workspace versions to `X.Y.Z-rc.N` with the repository version command.
2. Create and push `vX.Y.Z-rc.N`; CI publishes npm on `next` and marks the GitHub Release as a prerelease.
3. CI builds, signs, notarizes, and attaches the installers.
4. CI deploys the Squirrel update assets and macOS `RELEASES.json` into the candidate static feed.
5. Verify the three public feed endpoints. From RC2 onward, test an update from the previous candidate on macOS and Windows before promotion.
6. Publish `vX.Y.Z` as a normal release; stable clients will then discover it through the public Electron service.
