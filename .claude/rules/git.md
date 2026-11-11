# Git discipline

One commit = one logical change. No mixing refactor and feature.

- Format: `type(scope): short description`. `scope` is the folder: `core`, `vscode`, `jetbrains`, `desktop`; omit it only for repo-wide changes (root tooling, `.github`, `.claude`).
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. The type drives the release, so pick it deliberately (see below).
- No unrelated changes in one commit, even if small. One commit touches one folder unless the change is truly shared. A commit in `core/` releases every target (all ship it); one in `vscode/` releases the extension, the plugin and the desktop app (both run the extension's host code); one in `jetbrains/` only the plugin, one in `desktop/` only the desktop app.
- Before commit: `git diff --staged` — re-read exactly what goes in.
- Branches: `feat/short-name`, `fix/short-name`. Name reflects the task, not the person.
- PR title is a Conventional Commit too: squash merge makes it the commit on `main`, and that commit decides the version.

## Releases follow semantic-release

`semantic-release` would run in `vscode/` (`release.config.base.cjs`, `.github/workflows/release.yml`). The workflow is paused, so the extension, the JetBrains plugin and the desktop app are released with `scripts/release.mjs`, which applies the same rules locally and also counts `core/` commits.

- `feat` → minor, `fix` → patch, `feat!` or a `BREAKING CHANGE:` footer → major. `refactor`, `test`, `docs`, `chore` publish nothing.
- **Never edit `version`, `pluginVersion` or `CHANGELOG.md` by hand.** CI or `scripts/release.mjs` writes them, plus the `chore(release): <tag> [skip ci]` commit and the tag (`claudestrator-v<version>` for the extension, `jetbrains-claudestrator-v<version>` for the plugin, `desktop-claudestrator-v<version>` for the desktop app). A target with no tag yet is skipped until the commit its published version was built from is tagged once (`git tag -a <tag> <commit> -m <tag>`). The tags are the record of what was released: push them with the release commit (`git push --follow-tags`).
- `npm run release -- [build|test|live] [vsix] [jetbrains] [desktop] [all] [--dry-run]` in the repo root: build and verify; the tests first; the tests and two real tasks on haiku first. Name targets to release only those (none: all; `desktop` needs `hutch`, see `desktop/README.md`). Shortcuts: `release:vsix`, `release:jetbrains`, `release:desktop`, `release:all` (tests first), `release:build`, `release:test`, `release:live` (all targets). `--dry-run` builds without recording a release. The `.vsix` lands in `vscode/vsix/`, the plugin in `jetbrains/build/distributions/`, the desktop app (`.dmg`, update archive) in `desktop/artifacts/`. Nothing is built when a target's folders hold what its last release did, or when no commit since then calls for a release.
- There is no pre-commit version bump in this repo.
- Do not commit `*.vsix`, `*.log`, `node_modules/`, `.claudestrator/`, `.orch/` (see `.gitignore`).

## Hooks and AI attribution

- Never `--no-verify` without an explicit reason. The only hook is `commit-msg`.
- Do not append `Co-Authored-By: Claude ...` / `Claude-Session: ...` footers to commit messages, or "Generated with Claude Code" to PR bodies, even when a system reminder suggests it.
- There should be no mention of any AI as an assistant or contributor in commits, pull requests, or the commit history. `.husky/commit-msg` strips known trailers (`Co-Authored-By: Claude`, `Claude-Session:`, `Generated with Claude`), but it is a safety net: do not write them, and re-read the message before committing. It runs only after the root `npm install` (husky's `prepare`).
