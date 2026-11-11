# claudestrator

Claudestrator: a pipeline of Claude Code agents (plan → your approval → code and tests per repo → parallel review with fix rounds → confirmed push). One engine, several hosts:

| Folder | What | Notes |
|---|---|---|
| `core/` | engine (`src/`) and dashboard page (`page/`) | imports no editor API; tests in `test/` (unit, end to end against `test/fixtures/fake-claude.ts`, `live/` on real Claude Code); `scripts/build-page.mjs` builds the page into a host's folder |
| `vscode/` | the VS Code extension | `extension.ts` wires `activate()`; `src/orchestrator.ts` drives the engine, `src/panel.ts` serves the page in a webview, `src/tree.ts` the task list; preview harness in `test/harness/`; `scripts/design-sync/` rebuilds the Penpot file's Screens page from the dashboard (its README) |
| `jetbrains/` | the plugin for IntelliJ-based IDEs | Kotlin (`src/main/kotlin`) around a Node sidecar (`sidecar/`) that bundles `vscode/src` + `core/src` with `vscode` shimmed; see its README |

The root `package.json` is release tooling only (semantic-release rules, husky). Releases come from `scripts/release.mjs`: `npm run release:vsix | release:jetbrains | release:all`, or `npm run release -- <build|test|live> <vsix|jetbrains|all…> [--dry-run]`. A desktop app is planned (`desktop`, not in the repo yet; the release script already reserves the name).

## Build

Everything is TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Compiler options live in the root `tsconfig.base.json`; each package's `tsconfig.json` extends it.

- `core/`: `npm ci`, then `npm run build | typecheck | lint | test`, `test:live`, `test:live:forges`, `eval`. Build output in `dist/` (`dist/page` is the page).
- `vscode/`: needs `npm ci` in `core/` first. Its `tsc` has `rootDir: ".."` and compiles `core/src` with it: `dist/vscode/extension.js` (`main`), `dist/core/src/*`, and the page in `dist/page`. `npm test` runs the host's tests (`dist/vscode/test`).
- `jetbrains/`: `npm ci` in `core/`, `vscode/` (the `@types/vscode` the sidecar is checked against) and `sidecar/`; `./gradlew runIde | buildPlugin | verifyPlugin`. `buildPlugin` runs the sidecar's build.

The page's scripts (`core/page/*.ts`) are plain browser scripts with no imports, typechecked together (`tsconfig.page.json`) and transpiled one by one. Every host lists them in the same order: `PAGE_SCRIPTS` in `vscode/src/panel.ts`, `SCRIPTS` in `jetbrains/.../ui/PageHtml.kt` (the release script checks they agree).

## Rules

`.claude/rules/git.md` (commit format with folder scope, release behaviour, no AI attribution), `.claude/rules/typescript.md`, `.claude/rules/principles.md`, and the `ts-performance` skill for host hot paths. The only git hook is husky's `commit-msg`, activated by the root `npm install`. CI (`ci.yml`) and `release.yml` are paused (`workflow_dispatch` only): run the checks locally.

## Writing code

- What more than one host needs goes in `core/`. A host folder holds only what talks to its editor.
- Data from outside arrives as `unknown` and is narrowed once, at the boundary: config YAML, `~/.claude` files, hook payloads, stream-json, webview and sidecar messages, editor settings.
- The page's CSS uses only the `--cs-*` design tokens declared at the top of `core/page/app.css`. Host theme variables (`--vscode-*`) are read there and nowhere else, and components have no colour literals. Light and high-contrast variants key on the `<body>` class that VS Code sets; the JetBrains plugin sets the same class (`ThemeCss.bodyClass()`).
- What the host and the page say to each other is typed in `core/src/wire.ts` (types only: the page cannot load modules). The host receives a page message as `unknown` (`DashboardPanel.onMessage`) and narrows it; the page reads replies through the same types (`core/page/globals.d.ts`).
- Functions with 3+ positional parameters take an options object. Edges (fs, process runner, git, clock) come in as small interfaces where a test needs a fake.
- No `*Sync` I/O in the extension host (`ts-performance`).
- Add a test for logic changes: in `core/test` for the engine and the page, in `vscode/test` for the extension's host code.
- Delete dead code. No flags or parameters "for the future".
