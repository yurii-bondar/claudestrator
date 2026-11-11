# Claudestrator

A ticket in, reviewed draft PRs out, across several repos: a pipeline of Claude Code agents that plan, wait for your approval, write the code and tests in each repo, review it in parallel with fix rounds, and push once you confirm. What it does and how to use it: [the extension's README](vscode/README.md).

| Folder | What | Ships as |
|---|---|---|
| [`core/`](core) | the engine and the dashboard page, shared by every host | part of each host |
| [`vscode/`](vscode) | the VS Code extension | `.vsix` (VS Code Marketplace, Open VSX) |
| [`jetbrains/`](jetbrains) | the plugin for IntelliJ-based IDEs: Kotlin around a Node sidecar that runs the engine | `.zip` (JetBrains Marketplace) |

## Develop

```bash
npm ci                                   # release tooling and the commit-msg hook
(cd core && npm ci && npm test)
(cd vscode && npm ci && npm test)
(cd jetbrains/sidecar && npm ci && npm run build)
(cd jetbrains && ./gradlew runIde)
```

## Release

```bash
npm run release:vsix        # the VS Code extension: tests, then the .vsix
npm run release:jetbrains   # the JetBrains plugin: tests, then the .zip
npm run release:all         # every target at once
npm run release -- live vsix jetbrains --dry-run   # any mode (build, test, live), any targets, without recording
```

The script (`scripts/release.mjs`, `--help`) works out each target's next version from the conventional commits since its last tag (`claudestrator-v*`, `jetbrains-claudestrator-v*`), builds and verifies the artifact, and records the release as a `chore(release)` commit and a tag. `desktop` is a target name already, refused until the desktop app is in the repo.

## License

[MIT](LICENSE)
