# Claudestrator for the desktop

Claudestrator without an editor around it: the engine and the dashboard of the [VS Code extension](../vscode) in a window of their own, built with [Electrobun](https://docs.electrobun.dev) (Bun and the system's webview, no Chromium in the bundle). Nothing of the engine or the dashboard is rewritten: the app runs the extension's host code (`vscode/src/orchestrator.ts`, `panel.ts`) on the core, as the JetBrains plugin does.

## How it works

```
 one Bun process
┌──────────────────────────────────────────┐           ┌──────────────────────────────────────┐
│ main thread (src/bun)                    │  RPC,     │ system webview (src/view)            │
│   window, menu, native dialogs,          │ ◄───────► │   the dashboard page (core/page)     │
│   notifications, the OS's hand-offs      │  batched  │   + the bridge: acquireVsCodeApi,    │
│        ▲ postMessage (structured clone)  │           │     theme from the system's look     │
│        ▼                                 │           └──────────────────────────────────────┘
│ engine worker (src/engine)               │
│   Orchestrator + DashboardPanel          │   agents, checks and git hooks: child processes,
│   (vscode/src + core/src, unchanged)     │   the sandbox runtime started with the app's Bun
│   on core/src/vscode-shim.ts             │
└──────────────────────────────────────────┘
```

- **Two threads.** Electrobun's dialogs (message boxes, the file picker) are synchronous calls into the OS: the thread that makes one waits until it closes. The engine therefore runs in a worker, and the main thread holds only the window, the menu and those dialogs. While a dialog is open, agents stream, the hook server answers and the task folders are watched as usual. The two talk with `postMessage` (typed in `src/shared/protocol.ts`), with no JSON text and no extra process.
- **The `vscode` module** is `core/src/vscode-shim.ts`, the stand-in the JetBrains sidecar uses as well. What it asks of an editor is answered in `src/engine/host.ts`. Settings, secrets (the system keychain, through `Bun.secrets`), terminals and toasts stay in the worker. Dialogs, the clipboard and handing a path or a link to the OS go to the main thread.
- **The page** is `core/page`, served from the app's bundle (`views://dashboard/`). `src/view/index.ts` gives it `acquireVsCodeApi()` and the four themes. `src/view/theme.css` holds the palette of the design file (Penpot, "Claudestrator — Design System & Redesign": `Theme/*`) under the names of VS Code's theme variables, which the page's `--cs-*` tokens are made from. Light, dark and high contrast follow the system.
- **Speed.** The window opens without waiting for the engine. The main thread loads only the parts of Electrobun's SDK it uses (about 210 KB of script). The engine's ~700 KB bundle is parsed by the worker in parallel. What the engine posts to the page in one turn of its loop crosses as one message: one encryption and one socket frame, however much an agent streamed. Health checks run when something first needs them.

## Claudestrator directory and work directories

- **The Claudestrator directory** is where Claudestrator keeps its own files: `.claudestrator/config.yaml` (agents, scenarios, repos, checks) and `.orch/` (tasks with their plans, reports and transcripts, and the worktrees of tasks that use them). It is `~/Claudestrator` until you choose another one (File → Choose Claudestrator Directory…, or Settings → Claudestrator directory). For the engine, this is the workspace folder that VS Code opens.
- **Work directories** are the repositories Claudestrator sees and works in, anywhere on disk (File → Add Work Directories…, or Repos & checks). They go into the config with their absolute paths. Agents read them; a task changes only the ones its plan names.

## Accounts: the start screen

The app opens on Start: which Claude account the agents run under, the way a browser's profile picker asks whose it is.

- The first time there is only **+**. It makes a new Claude Code config folder (`~/.claude-2`, `~/.claude-3`, …), chooses it and runs `claude auth login` for it in a terminal. If the sign-in does not finish, the account you had before comes back and the empty folder goes.
- Accounts are Claude Code's config folders (`~/.claude`, `~/.claude-*`). Folders signed in to the same email make **one tile**, which works under the folder in use, else one that is signed in. The other folders are counted on the tile (`+1`) and listed in its tooltip.
- **Drag** a tile onto another to swap them, or move it with **Alt+← →**. The order is kept.
- The **pencil** gives a tile a short name (an alias). Enter keeps it, Esc leaves it, and an empty alias takes it off.
- The **bin** signs out of the account in each of its folders (`claude auth logout`, after you confirm) and removes its tile. The folders stay on disk, with their sessions and settings. To use the account again, add it with **+**.
- To get back to Start, use **All accounts…** in the account menu at the foot of the side rail, or Claudestrator → Switch Account…. From Start, **← Tasks** (or the tile in use) goes back without changing anything.

Order, aliases and removed folders are kept with the engine's state (`global-state.json` in the app's data folder), not in Claude Code's folders.

| VS Code | Desktop |
|---|---|
| The workspace folder | The Claudestrator directory |
| Repos in or around the workspace | Work directories (Repos & checks) |
| Commands (`Claudestrator: …`) | The menu (File, View, Help) |
| Notifications | System notifications, while the window is not in front (a finished task always) |
| Secret storage | The system keychain (service "Claudestrator") |
| Integrated terminal | The system terminal (macOS: Terminal, or the app `.command` files open with) |
| Output channel | Help → Show Log (`claudestrator.log`) |
| Settings `claudestrator.*` | Settings in the dashboard; stored in `settings.json`, defaults from `vscode/package.json` |

On macOS the app keeps running when its window closes, and so do its agents. The Dock icon opens the window again. Quitting stops the agents cleanly (they resume from the same step), giving them up to 5 s.

## Build and run

You need [hutch](https://docs.electrobun.dev), which brings Bun and the Electrobun devkit, plus what `core/` and `vscode/` need:

```bash
(cd ../core && npm ci)        # the engine's and the page's dependencies, TypeScript
(cd ../vscode && npm ci)      # the vscode types the engine thread is checked against
hutch install                 # Bun, the Electrobun devkit (.hutch/), node_modules
hutch run start               # build (dev) and open the app
hutch run dev                 # the same, rebuilt on changes in desktop/, core/ and vscode/src
hutch run build               # the stable build: build/stable-<os>-<arch>, artifacts/ (.dmg, update archive)
hutch run test                # bun test
hutch run typecheck           # tsconfig.json (the engine thread, strict) and tsconfig.app.json (what talks to Electrobun)
```

Run the scripts with `hutch run`: `hutch build` and `hutch test` are hutch's own commands. Every build first runs `scripts/prepare.ts`. It bundles the engine thread into `.gen/engine/worker.js`, aliasing `vscode` to the shim, and ships the sandbox runtime next to it. It also builds the page into `.gen/page`. `electrobun.config.ts` copies both into the app.

Electrobun ships its API as TypeScript sources, and they do not pass two of the repo's flags (`exactOptionalPropertyTypes`, `noImplicitReturns`). So the code that imports them (`src/bun`, `src/view`) is checked by `tsconfig.app.json`, which turns those two off. Everything else is as strict as the rest of the repo.

Where things live at run time (macOS): the app's data folder `~/Library/Application Support/io.github.yuriibondar.claudestrator/<channel>/` holds `settings.json`, `global-state.json`, `claudestrator.log` and `window.json`. The Claudestrator directory is `~/Claudestrator` until you choose another.

## Installing

`hutch run build` makes `artifacts/macos-arm64-Claudestrator.dmg` (Apple silicon; an Intel Mac needs a build made on one). Open it and drag Claudestrator into Applications. The first launch unpacks the app into its data folder (`~/Library/Application Support/io.github.yuriibondar.claudestrator/stable`, with an `uninstall` script).

Until the app is signed with a Developer ID, it is signed ad hoc. It opens at once on the Mac that built it. On another Mac, a copy downloaded from the web is held back by Gatekeeper the first time: Open in Finder's context menu, or System Settings → Privacy & Security → Open Anyway. `xattr -dr com.apple.quarantine /Applications/Claudestrator.app` does the same from a terminal.

## Signing and notarizing

`electrobun.config.ts` turns both on when the build has the credentials, so the same `hutch run build` makes an app every Mac opens:

```bash
export ELECTROBUN_DEVELOPER_ID="Developer ID Application: Your Name (TEAMID1234)"   # in your login keychain
export ELECTROBUN_TEAMID="TEAMID1234"
export ELECTROBUN_APPLEID="you@example.com"           # notarizing with an app-specific password
export ELECTROBUN_APPLEIDPASS="abcd-efgh-ijkl-mnop"   # appleid.apple.com → Sign-In and Security → App-Specific Passwords
# or, instead of the two above: ELECTROBUN_APPLEAPIKEY, ELECTROBUN_APPLEAPIISSUER, ELECTROBUN_APPLEAPIKEYPATH (App Store Connect)
hutch run build
```

The certificate comes with an Apple Developer Program membership (Certificates → Developer ID Application). The app runs with the hardened runtime, with the entitlements Bun's JavaScriptCore needs (JIT, its dylibs). It has no App Sandbox, because the engine runs git, gh, claude and the checks wherever your repos are. Without a Developer ID, `scripts/post-wrap.ts` writes the version Finder shows and signs the bundle ad hoc.

The icon is `assets/icon.svg`, the rail's logo on the brand gradient on macOS's icon grid. `bun scripts/icon.ts` renders it into `assets/icon.iconset`, which the build turns into the bundle's `.icns`.

## Release

From the repo root: `npm run release:desktop`. It runs the tests, works out the next version from the commits since the last `desktop-claudestrator-v<version>` tag, writes it to `package.json` (the app takes its version from there), builds, and checks the archive (the engine, the sandbox runtime, the page's scripts in the order the other hosts load them). The first release needs a tag on the commit to count from (`git tag -a desktop-claudestrator-v0.1.0 <commit> -m desktop-claudestrator-v0.1.0`).

## Not done yet

- **No Developer ID yet**: the builds are signed ad hoc until one is set (above).
- **Apple silicon only** so far: the builds here are arm64, and an Intel build was not tried.
- **No updates over the web**: `release.baseUrl` is not set, so a new version is installed from its .dmg.
- **Windows and Linux** are untested. Terminals open with `x-terminal-emulator` on Linux and not at all on Windows, where a sign-in says to run the command yourself. The sandbox runs on macOS and Linux only, as in the other hosts.
- **Notifications have no buttons.** Electrobun's do not take any: you answer on the dashboard.
- **Files open in their default app** (`Utils.openPath`), not in an editor beside the dashboard.
