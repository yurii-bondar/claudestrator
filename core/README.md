# Claudestrator core

The part of Claudestrator that every host shares: the engine and the dashboard page. It imports no editor API, so it runs under `node --test` as it is. The hosts:

- [`../vscode`](../vscode): the VS Code extension. Its host code (`src/orchestrator.ts`, `src/panel.ts`) drives the engine and serves the page in a webview; its build compiles this folder into `dist/core` and builds the page into `dist/page`.
- [`../jetbrains`](../jetbrains): the JetBrains plugin. Its sidecar bundles the engine with the extension's host code (with `vscode` shimmed) and builds the page into the engine folder.

| Folder | What |
|---|---|
| `src/` | the engine: config, state machine and pipeline, the agents' runner, guard and sandbox, git, forges and intake, the task store, the wire types the page reads (`wire.ts`) |
| `page/` | the dashboard page: plain browser scripts (no imports; `globals.d.ts` brings the wire types), `app.css`, the tab icon |
| `scripts/build-page.mjs` | builds the page into a folder: `node core/scripts/build-page.mjs <out>` |
| `test/` | the engine's and the page's tests; `fixtures/` (the fake Claude CLI), `helpers/`, `live/` (real Claude Code runs) |

```bash
npm ci
npm run typecheck && npm run lint
npm test                 # the engine end to end against a fake Claude CLI and real git repos, and the page's screens
npm run test:live        # two real tasks on haiku at low effort (a few cents)
npm run test:live:forges # the real gh, glab, Bitbucket and Linear, when their LIVE_* variables are set
npm run eval             # the agents' instructions against cases with a known answer
```

The page's CSS uses only the `--cs-*` tokens declared at the top of `page/app.css`; host theme variables (`--vscode-*`) are read there and nowhere else, and the JetBrains plugin answers the same variables (`ThemeCss.kt`).
