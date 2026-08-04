# OpenChamber Desktop

Electron desktop runtime for OpenChamber on macOS, Windows, and Linux.

This package owns the native shell: windows, menus, deep links, native notifications, desktop update policy, host switching, SSH connections, tunnel helpers, and packaged desktop builds. The web UI and OpenChamber server logic still live in `packages/web` and shared React UI lives in `packages/ui`.

## How It Runs

Desktop starts the OpenChamber web server in the same Electron main process. There is no separate sidecar subprocess for the OpenChamber server.

`main.mjs` imports `@openchamber/web/server/index.js` and calls `startWebUiServer()`. The Electron window then loads the UI from the local server in development, or from packaged `resources/web-dist` assets in packaged builds.

The preload bridge exposes desktop-only APIs to the web UI through `window.__OPENCHAMBER_DESKTOP__`. Privileged commands are checked in `main.mjs`, not only in the UI.

## Main Files

| File                               | Purpose                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `main.mjs`                         | Electron main process, app lifecycle, windows, menus, deep links, native IPC handlers, updates, local server startup |
| `preload.mjs`                      | Safe bridge from the rendered UI to Electron IPC                                                                     |
| `artifact-runner.mjs`              | Main-process lifecycle, URL, permission, concurrency, CPU, memory, and lease gates for Scripts Artifacts             |
| `artifact-runner-preload.cjs`      | Message-only Artifact transport; exposes no Electron API to the Artifact main world                                  |
| `ssh-manager.mjs`                  | SSH host import, connection lifecycle, tunnel/port forwarding helpers                                                |
| `scripts/electron-dev.mjs`         | Desktop dev launcher with Vite HMR support                                                                           |
| `scripts/build-web-assets.mjs`     | Builds `packages/web` and stages UI assets into `resources/web-dist`                                                 |
| `scripts/prepare-opencode-cli.mjs` | Downloads and stages the pinned OpenCode CLI into `resources/opencode-cli`                                           |
| `scripts/bundle-main.mjs`          | Bundles Electron main code into `dist-bundle/main.mjs` for packaging                                                 |
| `scripts/rebuild-native.mjs`       | Rebuilds native modules against the Electron runtime                                                                 |
| `scripts/package.mjs`              | Runs `electron-builder`, with unsigned Windows builds when signing env is missing                                    |
| `resources/`                       | Packaged web assets, icons, and macOS entitlements                                                                   |

## Development

From the repo root:

```bash
export GITHUB_PACKAGES_TOKEN="$(gh auth token)"
bun install
bun run electron:dev
```

OpenChamber consumes the fork-matched SDK from GitHub Packages. The token needs
read access to packages in `ZunbaRan/opencode`; do not commit it or place a
literal value in `.npmrc`. GitHub Actions uses `OPENCODE_PACKAGES_TOKEN` when
configured and otherwise falls back to the workflow `github.token` with
`packages: read`.

`bun run electron:dev` starts the web dev server with HMR, then launches Electron against `packages/electron/main.mjs`.

The Electron workspace package trusts Electron's install script so `bun install` downloads the platform runtime in fresh checkouts and worktrees.

Useful variants:

```bash
bun run electron:dev:bundled
bun run type-check:electron
bun run lint:electron
```

`electron:dev:bundled` builds and uses packaged web assets instead of the HMR server. Use it when testing behavior closer to a packaged app.

## Packaging

From the repo root:

```bash
bun run electron:build
```

That runs, in order:

1. `build:web-assets` to build the web UI and copy it into `packages/electron/resources/web-dist`.
2. `prepare:opencode-cli` to download/cache the pinned OpenCode CLI and copy it into `packages/electron/resources/opencode-cli`.
3. `bundle:main` to create `packages/electron/dist-bundle/main.mjs`.
4. `rebuild:native` to rebuild native modules for Electron.
5. `package.mjs` to run `electron-builder`; its `afterPack` hook stages the rebuilt `better-sqlite3` binary that Electron Builder's Bun dependency collector otherwise omits.

Build output goes to `packages/electron/dist`.

macOS builds produce `dmg` and `zip` artifacts. Windows builds produce an NSIS installer. Linux builds produce an AppImage for the native x64 or arm64 host.

## Platform Notes

macOS packaging needs Xcode/build tools for notarized builds and icon asset compilation.

Windows packaging needs NSIS support through `electron-builder`. If no Windows signing env is set, `package.mjs` disables code signing and builds an unsigned installer.

Linux AppImages must be built natively. Set `OPENCHAMBER_TARGET_ARCH=x64` or `OPENCHAMBER_TARGET_ARCH=arm64` when packaging; the build rejects a target that does not match the Linux host. The same target selects the bundled OpenCode CLI, native Electron rebuild, and Electron Builder architecture. Linux identity is stable across architectures: executable `openchamber`, desktop file `openchamber.desktop`, icon `openchamber`, and `StartupWMClass=openchamber`.

After packaging, run `bun run --cwd packages/electron verify:linux-appimage`. The verifier extracts the final AppImage and checks its ELF architecture, desktop identity, Electron executable, pinned OpenCode CLI version and architecture, and all packaged native `.node` modules.

Running a packaged Linux AppImage requires FUSE (`libfuse.so.2`, typically `libfuse2` / `libfuse2t64` on Debian/Ubuntu). Without FUSE, start with `APPIMAGE_EXTRACT_AND_RUN=1`.

Production Desktop updates use the public GitHub Release feed at `ZunbaRan/openchamber`. Packaged clients never query the upstream `openchamber/openchamber` release channel. Development builds keep the updater capability disabled.

Each published version must use a semver tag greater than the installed application version and include the platform artifacts plus electron-builder metadata produced by this repository's release workflow. In particular, macOS requires the merged `latest-mac.yml` and matching ZIP/blockmap assets in addition to the user-facing DMG; Windows requires `latest.yml` and the matching NSIS installer/blockmap. A Release without the expected platform manifest is treated as no available update rather than falling back to upstream.

### Updater End-to-End Fixture

A loopback-only updater fixture remains available for contributor QA. It is enabled only by the embedded E2E build marker together with `OPENCHAMBER_E2E=1` and a credential-free loopback URL; invalid or incomplete E2E configuration resolves to no feed and never falls back to the production GitHub source. It is test infrastructure, not a user-configurable update source. See [`scripts/updater-e2e-fixture.md`](./scripts/updater-e2e-fixture.md) for the controlled procedure.

The package supports macOS, Windows, and Linux desktop features. Linux AppImage builds include in-app window controls, auto-update, system tray, and launch-at-login (XDG autostart). Some native discovery helpers are platform-specific. For example, app icon fetching and app filtering currently only work on macOS, while opening files in installed apps and installed-app discovery work on macOS, Windows, and Linux.

The macOS menu bar item is enabled by default and can be disabled in General settings. The setting applies after restart; while disabled, Desktop does not create the native tray controller or start the renderer subscriptions, polling, quota refresh, or IPC updates that feed it.

## Bundled OpenCode CLI

Packaged Desktop builds include the OpenChamber-managed OpenCode fork pinned by `opencode-cli.lock.json`. `prepare:opencode-cli` downloads only the platform-specific `ZunbaRan/opencode` release artifact named in that lock, verifies its SHA256, caches it under `packages/electron/.cache/opencode-cli`, stages `opencode` or `opencode.exe` into `resources/opencode-cli`, and verifies `opencode --version` before packaging. Re-running the step is fast when the staged binary already matches the locked version.

Managed local Desktop startup prefers OpenCode binaries in this order:

1. `settings.opencodeBinary`.
2. Environment overrides: `OPENCODE_BINARY`, `OPENCODE_PATH`, `OPENCHAMBER_OPENCODE_PATH`, or `OPENCHAMBER_OPENCODE_BIN`.
3. The bundled Desktop CLI in `process.resourcesPath/opencode-cli`.
4. System installs discovered from PATH.
5. Known npm/Bun/Homebrew/Scoop/Chocolatey and other standard install locations.
6. Platform discovery through `where opencode` on Windows or a login shell on macOS/Linux.

Use an explicit override when testing a different OpenCode CLI build or when a user needs to point Desktop at a custom binary. The configured path must point to the standalone CLI, not the OpenCode Desktop app executable.

## Common Env Vars

| Variable                                   | Use                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENCHAMBER_ELECTRON_DEV=1`               | Marks the runtime as desktop development mode                                                                                                                                                                                  |
| `OPENCHAMBER_ELECTRON_USE_BUNDLED_UI=1`    | Uses staged web assets instead of the HMR dev server                                                                                                                                                                           |
| `OPENCHAMBER_SKIP_LOCAL_SERVER=1`          | Skips the in-process local OpenChamber server and uses the configured default remote instance; Desktop imports this from the user's login-shell environment, and packaged/bundled UI remains available for connection recovery |
| `OPENCHAMBER_HMR_UI_PORT`                  | Preferred Vite UI port for desktop dev, default `5173`                                                                                                                                                                         |
| `OPENCHAMBER_HMR_API_PORT`                 | Preferred API port for desktop dev, default `3901`                                                                                                                                                                             |
| `OPENCHAMBER_RUNTIME=desktop`              | Set by Electron before starting the web server                                                                                                                                                                                 |
| `OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS=false` | Emergency kill switch for the default-enabled Managed Desktop Scripts Runner                                                                                                                                                   |

The bundled CLI version is not overrideable at packaging time. Update `opencode-cli.lock.json` from a verified `ZunbaRan/opencode` release, including all platform hashes and exact upstream/fork commits.
| `OPENCHAMBER_TARGET_ARCH` | Explicit desktop package architecture (`x64` or `arm64`); Linux requires it to match the native host |
| `OPENCHAMBER_DESKTOP_NOTIFY=true` | Enables desktop notification flow in the web server |
| `OPENCHAMBER_SKIP_API_COMPRESSION=true` | Defaulted by Desktop to reduce local CPU overhead |
| `OPENCODE_HOST` / `OPENCODE_PORT` / `OPENCODE_SKIP_START` | Connect Desktop to an external OpenCode server instead of starting one locally |

## Native Features Owned Here

- Floating Mini Chat windows.
- Multiple native windows.
- Native notifications.
- One-click open/reveal/open-in-app actions.
- Desktop host switcher and deep-link imports.
- Local and remote instance handling.
- SSH host import, connections, logs, and port forwarding.
- SSH uses OpenSSH ControlMaster on macOS/Linux. Windows uses independent hidden OpenSSH processes for setup commands and each long-lived forward because Win32 OpenSSH does not support ControlMaster reliably.
- Tunnel lifecycle integration through the web server runtime.
- Fork-owned production GitHub updater plus an isolated loopback-only E2E updater flow.

## IPC Pattern

Renderer code should call the desktop bridge exposed by `preload.mjs`. Do not import Electron from shared UI code.

Add new native capabilities in this order:

1. Add or update the `preload.mjs` bridge only if a new renderer-facing shape is needed.
2. Add the real command handling in `main.mjs` under `openchamber:invoke`.
3. Gate privileged commands in main process logic so remote pages cannot access local filesystem or shell capabilities.
4. Keep shared UI runtime contracts in `packages/ui` and server/runtime APIs in `packages/web` when the behavior is not inherently native.

MCP App binary exports use a request-bound, cancellable IPC transaction. The
renderer sends a unique request ID with `desktop_save_binary_file` and sends
`desktop_cancel_binary_file_save` when its AppBridge request is aborted. The
main process binds cancellation to the originating renderer/window, rechecks it
after the native dialog and every awaited filesystem boundary, and publishes
only by an atomic same-directory rename. Dialog cancellation, renderer/window
closure, or AppBridge abort must not publish a destination; any unpublished
temporary file is closed and removed before the per-window transaction registry
is released.

### Scripts Artifact Runner

Managed Desktop never renders Scripts Artifacts in the privileged UI renderer. `ArtifactExecutionSurface` asks the main process for a `WebContentsView` using a unique non-persistent partition, `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, and a preload that exposes no main-world object. The main process accepts only exact generated/installed Artifact document routes, denies permissions, windows, webviews and unexpected requests/navigation, and terminates the renderer on Stop, lease expiry, memory budget breach, sustained CPU saturation, crash, or owner-window closure. Static Artifacts continue to use the browser iframe backend.

Inline Runner clipping is a native/runtime contract, not a CSS stacking contract. The renderer sends full surface and clipping-ancestor intersections; the main process bounds the `WebContentsView` to the visible intersection, and the trusted Broker preload preserves the full child iframe size with a clipped-content offset. The native View remains hidden until that layout is acknowledged, and clipping-induced resize echoes are rejected. Validate this boundary with `bun run test:artifact-runner-clipping-packaged`, which captures the composed macOS window rather than the main renderer alone.

## Logs And Data

Electron uses `electron-log`. In development, console logs are also visible in the terminal. In packaged apps, logs are written through the platform log path for the `OpenChamber` app name.

Development builds use a separate user data directory named `OpenChamber Dev`, so dev state does not overwrite normal packaged app state.

## Things To Be Careful With

- Keep desktop-specific code in this package. Do not move OpenCode feature backend logic into Electron.
- Use hidden Windows process launches for background helpers. Avoid visible console flashes.
- Keep `@openchamber/web`, `bun-pty`, `node-pty`, and native modules external in `bundle-main.mjs`; bundling them can break Electron startup.
- Rebuild native modules after dependency or Electron version changes.
- Test both HMR dev mode and bundled UI mode when changing startup, preload, routing, or packaged asset behavior.

## Quick Checks

```bash
bun run type-check:electron
bun run lint:electron
bun run electron:dev:bundled
```

For full repo validation before shipping:

```bash
bun run type-check
bun run lint
```
