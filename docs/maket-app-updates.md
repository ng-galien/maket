# Maket App updates

Maket App downloads updates in the background. Settings displays the installed version, download progress and a **Restart** action when the update is ready. Restart stops the embedded server, installs the update and relaunches Maket. An installation refusal restores the server. No browser or manually launched installer is involved in subsequent updates.

## Platform engines

- **macOS:** Sparkle verifies each archive against the Ed25519 public key in `packages/desktop/update-public-key.txt`, embedded as `SUPublicEDKey` in the application. Forge signs the completed app bundle ad hoc. No paid Apple certificate or notarization is used. Initial installation still follows macOS security rules. Existing releases using Squirrel and ad-hoc signatures need one manual installation of the Sparkle-enabled version.
- **Windows:** Electron's Squirrel updater uses the public Electron update service for stable releases and the existing static candidate feed for prereleases. The installer remains unsigned.
- **Linux:** the updater detects the package manager that owns the running executable and downloads the matching DEB or RPM. The system may ask for authorization to install it. Unpackaged executables cannot update through a package manager.

The updater permits newer major versions. Stable receives final releases; Candidate receives prereleases and final releases. Local installers marked `--local-install`, snapshots and development builds do not contact public update feeds.

## Signing and publication

The private update key is a 32-byte Ed25519 seed encoded in base64. Keep it outside the repository and preserve it across releases. Only its public half belongs in source. CI uses the repository secret `MAKET_UPDATE_PRIVATE_KEY`; local signing accepts `MAKET_UPDATE_KEY_FILE`. Neither is a paid certificate. Losing the private key prevents existing ad-hoc installations from trusting new archives.

`npm run desktop -- make --arch=<arch>` builds with the Node major in `.desktop-node-version`. On macOS it rebuilds the Sparkle bridge for the target Electron version and architecture, copies the framework and bridge into the app, then applies the ad-hoc signature. Linux includes its updater cache configuration.

A release tag passes version, ancestry and changelog checks before building all four platform targets. macOS archive signing occurs before publication; missing keys or a key that differs from the embedded public key fail the build. The release publishes installers and signatures, then deploys the update feeds after the assets have been attached.

The feed deployment verifies macOS archive signatures again, writes architecture-specific Sparkle appcasts and Linux SHA-512 download metadata, and preserves newer releases already present in either channel. Routine website deployments preserve these feeds. Update archives are versioned GitHub Release assets; they are not copied into the website.

The five canonical human downloads remain DMG for macOS arm64/x64, Setup.exe for Windows x64, and DEB/RPM for Linux x64. They are needed for initial installation.

## Release verification

Use a packaged installation with public updates enabled, not a marked snapshot. Verify a patch version updating to the following minor version, the relaunch version, and preservation of documents, assets, settings and MCP connections. Test with a separate workspace and a backup before exercising a schema migration. Also verify refusal of an altered archive, recovery after an installation error, and normal operation when the feed is unreachable.

The native engine and package installation must be exercised on each supported platform. Passing JavaScript tests alone does not validate installation or relaunch.
