// Syncing the workspace's repos with their default branch: each one pulls origin's default branch (a feature branch
// checked out gets it merged in, and a conflict is left for Claude Code to resolve), then lists the branches whose
// work the default branch already holds, locally and on origin, for you to delete. Nothing is deleted before you
// choose; the default branch, the protected ones and a branch with work of its own are never offered.
//
// A branch counts as merged when one of these holds against origin/<default>:
//   * its tip is an ancestor of the default branch (a merge or a fast-forward)
//   * its tree is the default branch's (nothing left to merge)
//   * its whole diff is in the default branch (a squash merge)
//   * every one of its commits has an equivalent patch there (a rebase or cherry-pick)
//   * it is a level of a merged stack: merging it adds nothing, another merged branch holds it, or one holds a commit
//     with its very tree (a PR squash-merged into the PR above it)
//   * it is an early draft of work the default branch holds in a later form: with the default branch winning every
//     conflict the merge changes nothing, and in each file it touches every identifier, number and string it adds or
//     removes is added or removed there too
import * as path from 'path';
import { exists } from './files';
import { GitRepo, OWNER_KEY } from './git';
import type { Deleted, KeptBranch, MergedBranch, PullOutcome, RepoSync } from './wire';

/** A run of git that never waits for a password: missing credentials fail it at once instead. */
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0' };

/** Untracked paths a worktree may hold and still go: output an install or a build makes again, never a file written by hand. */
const DISPOSABLE_UNTRACKED = /(^|\/)(node_modules|dist|build|coverage|\.nuxt|\.output|\.turbo)(\/|$)|(^|\/)src\/generated(\/|$)/;

interface SyncOptions {
  /** Whether a branch Claudestrator made belongs to a task that is not finished: its branch must stay. */
  taskUnfinished(taskId: string): Promise<boolean>;
  /** Branches never offered, beyond main, master and the default branch. */
  protect?: readonly string[];
}

/** The output of a git command, its first lines, for a report. */
const gitError = (r: { stdout: string; stderr: string }): string => (r.stderr.trim() || r.stdout.trim()).split('\n').slice(0, 5).join('\n');

/** The default branch of origin: origin/HEAD, set again when it is missing, then main or master. */
async function defaultBranch(g: GitRepo): Promise<string | null> {
  const head = async (): Promise<string | null> => {
    const r = await g.git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim().replace(/^origin\//, '') : null;
  };
  const found = (await head()) || ((await g.git('remote', 'set-head', 'origin', '--auto')).code === 0 ? await head() : null);
  if (found) return found;
  for (const candidate of ['main', 'master']) if ((await g.git('show-ref', '--verify', '--quiet', `refs/remotes/origin/${candidate}`)).code === 0) return candidate;
  return null;
}

const firstLine = (text: string): string => text.split('\n')[0]!.trim();

/** Merging `ref` into `base` leaves the base's tree as it is. */
async function addsNothing(g: GitRepo, ref: string, base: string): Promise<boolean> {
  const merged = await g.git('merge-tree', '--write-tree', base, ref);
  if (merged.code !== 0) return false;
  return firstLine(merged.stdout) === (await g.git('rev-parse', `${base}^{tree}`)).stdout.trim();
}

/** Identifiers, numbers and string literals of a file at a commit, counted; a package.json's version is left out. */
async function countedTokens(g: GitRepo, rev: string, file: string): Promise<Map<string, number>> {
  const r = await g.git('show', `${rev}:${file}`);
  const counts = new Map<string, number>();
  if (r.code !== 0) return counts;
  for (const line of r.stdout.split('\n')) {
    if (file.endsWith('package.json') && /^\s*"version"\s*:/.test(line)) continue;
    for (const token of line.match(/[A-Za-z_$][A-Za-z0-9_$]*|[0-9][0-9.]*|"[^"]*"|'[^']*'|`[^`]*`/g) || []) counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

/**
 * The branch's work reached the base in a later, reworked form, so merging it would only conflict: merged with the
 * base winning every conflict it changes nothing, and in every file it touches each token it adds is added in the base
 * at least as often, and each one it removes is removed at least as often.
 */
async function superseded(g: GitRepo, ref: string, base: string, mergeBase: string): Promise<boolean> {
  const merged = await g.git('merge-tree', '--write-tree', '-X', 'ours', base, ref);
  if (merged.code !== 0 || firstLine(merged.stdout) !== (await g.git('rev-parse', `${base}^{tree}`)).stdout.trim()) return false;
  const files = (await g.git('diff', '--name-only', mergeBase, ref)).stdout.split('\n').filter(Boolean);
  for (const file of files) {
    const [was, branch, now] = await Promise.all([countedTokens(g, mergeBase, file), countedTokens(g, ref, file), countedTokens(g, base, file)]);
    for (const token of new Set([...was.keys(), ...branch.keys(), ...now.keys()])) {
      const ours = (branch.get(token) || 0) - (was.get(token) || 0);
      const theirs = (now.get(token) || 0) - (was.get(token) || 0);
      if ((ours > 0 && theirs < ours) || (ours < 0 && theirs > ours)) return false;
    }
  }
  return true;
}

/** Whether every change of `ref` is already in `base` (both full ref names). */
async function isMerged(g: GitRepo, ref: string, base: string, nested = false): Promise<boolean> {
  if ((await g.git('merge-base', '--is-ancestor', ref, base)).code === 0) return true;
  const mb = await g.git('merge-base', base, ref);
  const mergeBase = mb.stdout.trim();
  if (mb.code !== 0 || !mergeBase) return false;
  if ((await g.git('diff', '--quiet', base, ref)).code === 0) return true;
  // A squash merge: the whole branch as one commit off the merge base, and whether that patch is in the base.
  const tree = (await g.git('rev-parse', `${ref}^{tree}`)).stdout.trim();
  if (!tree) return false;
  const synth = await g.gitWith({ env: { GIT_AUTHOR_NAME: '_', GIT_AUTHOR_EMAIL: '_@_', GIT_COMMITTER_NAME: '_', GIT_COMMITTER_EMAIL: '_@_' } }, 'commit-tree', tree, '-p', mergeBase, '-m', '_');
  if (synth.code === 0 && (await g.git('cherry', base, synth.stdout.trim())).stdout.startsWith('-')) return true;
  // A rebase or cherry-pick: every commit has an equivalent patch in the base.
  const cherry = await g.git('cherry', base, ref);
  if (cherry.code === 0 && cherry.stdout.trim() && !/^\+/m.test(cherry.stdout)) return true;
  // A squash of a stack, or one that also carries conflict resolutions: merging it changes nothing.
  if (await addsNothing(g, ref, base)) return true;
  if (await superseded(g, ref, base, mergeBase)) return true;
  // An older point of a branch that is itself contained: a stack level left behind.
  const holding = (await g.git('for-each-ref', '--contains', ref, '--format=%(refname)', 'refs/heads/', 'refs/remotes/origin/')).stdout.split('\n').filter((o) => o && o !== ref && o !== base);
  for (const other of holding) if (await addsNothing(g, other, base)) return true;
  // A stack level squash-merged into the branch above it, which reached the base on its own: that branch holds a
  // commit with this one's very tree. One level deep, so the search never recurses.
  if (nested) return false;
  const refs = (await g.git('for-each-ref', '--format=%(if)%(symref)%(then)%(else)%(refname)%(end)', 'refs/heads/', 'refs/remotes/origin/')).stdout.split('\n').filter((o) => o && o !== ref && o !== base);
  for (const other of refs) {
    const trees = (await g.git('log', '--format=%T', `${base}..${other}`)).stdout.split('\n');
    if (trees.includes(tree) && (await isMerged(g, other, base, true))) return true;
  }
  return false;
}

/** The linked worktree (never the main one) that has `branch` checked out. */
async function worktreeOf(g: GitRepo, branch: string): Promise<{ dir: string; locked: boolean } | null> {
  const blocks = (await g.git('worktree', 'list', '--porcelain')).stdout.split('\n\n').slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    if (!lines.includes(`branch refs/heads/${branch}`)) continue;
    const dir = (lines.find((l) => l.startsWith('worktree ')) || '').slice('worktree '.length);
    return { dir, locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')) };
  }
  return null;
}

/** Why a checkout cannot go without losing something; null when nothing in it would be lost. */
async function keepReason(dir: string, locked = false): Promise<string | null> {
  if (locked) return 'its worktree is locked';
  if (!(await exists(dir))) return null;
  const g = new GitRepo(dir);
  if ((await g.git('status', '--porcelain', '--untracked-files=no')).stdout.trim()) return 'uncommitted changes to tracked files';
  const untracked = (await g.git('status', '--porcelain', '--untracked-files=all')).stdout
    .split('\n')
    .filter((l) => l.startsWith('?? '))
    .map((l) => l.slice(3))
    .filter((f) => !DISPOSABLE_UNTRACKED.test(f));
  return untracked.length ? `untracked files: ${untracked.slice(0, 3).join(', ')}` : null;
}

/** Pulls origin's default branch into what the repo has checked out: fast-forward on it, a merge on a feature branch. */
async function pullDefault(g: GitRepo, base: string): Promise<PullOutcome> {
  const branch = (await g.git('branch', '--show-current')).stdout.trim();
  if (!branch) return { kind: 'skipped', branch: '', reason: 'no branch is checked out (detached HEAD)' };
  const unmerged = (await g.git('diff', '--name-only', '--diff-filter=U')).stdout.split('\n').filter(Boolean);
  if (unmerged.length) return { kind: 'conflict', branch, base, files: unmerged };
  if ((await g.git('status', '--porcelain', '--untracked-files=no')).stdout.trim()) return { kind: 'skipped', branch, reason: 'uncommitted changes to tracked files' };
  const before = (await g.git('rev-parse', '--short', 'HEAD')).stdout.trim();
  const moved = async (kind: 'updated' | 'merged'): Promise<PullOutcome> => {
    const after = (await g.git('rev-parse', '--short', 'HEAD')).stdout.trim();
    return after === before ? { kind: 'up-to-date', branch } : { kind, branch, from: before, to: after };
  };
  if (branch === base) {
    const r = await g.gitWith({ env: NO_PROMPT }, 'merge', '--ff-only', `origin/${base}`);
    return r.code === 0 ? moved('updated') : { kind: 'failed', branch, reason: `${base} has commits of its own and cannot fast-forward to origin/${base}` };
  }
  // The local default branch moves too, as a fast-forward of its ref; one with commits of its own stays where it is.
  if ((await g.git('show-ref', '--verify', '--quiet', `refs/heads/${base}`)).code === 0) await g.gitWith({ env: NO_PROMPT }, 'fetch', '--quiet', '.', `refs/remotes/origin/${base}:refs/heads/${base}`);
  const r = await g.git('merge', '--no-edit', `origin/${base}`);
  if (r.code === 0) return moved('merged');
  const files = (await g.git('diff', '--name-only', '--diff-filter=U')).stdout.split('\n').filter(Boolean);
  if (files.length) return { kind: 'conflict', branch, base, files };
  await g.git('merge', '--abort');
  return { kind: 'failed', branch, reason: gitError(r) };
}

/** The merged branches of a repo, local and on origin, and the merged ones that stay. */
async function collectMerged(g: GitRepo, repo: string, base: string, opts: SyncOptions): Promise<{ merged: MergedBranch[]; kept: KeptBranch[] }> {
  const protectedNames = new Set(['main', 'master', 'HEAD', base, ...(opts.protect || [])]);
  const merged: MergedBranch[] = [];
  const kept: KeptBranch[] = [];
  const baseRef = `refs/remotes/origin/${base}`;
  const current = (await g.git('branch', '--show-current')).stdout.trim();
  const taskOf = async (branch: string): Promise<string | null> => {
    const task = (await g.git('config', '--get', `branch.${branch}.${OWNER_KEY}`)).stdout.trim();
    return task && (await opts.taskUnfinished(task)) ? task : null;
  };
  const locals = (await g.git('for-each-ref', '--format=%(refname:short)', 'refs/heads/')).stdout.split('\n').filter(Boolean);
  for (const branch of locals) {
    if (protectedNames.has(branch) || !(await isMerged(g, `refs/heads/${branch}`, baseRef))) continue;
    const task = await taskOf(branch);
    if (task) {
      kept.push({ repo, branch, reason: `Claudestrator task ${task} is not finished` });
      continue;
    }
    const tip = (await g.git('rev-parse', '--short', `refs/heads/${branch}`)).stdout.trim();
    const id = `${repo}:local:${branch}`;
    if (branch === current) {
      const why = await keepReason(g.dir);
      if (why) kept.push({ repo, branch, reason: `checked out here: ${why}` });
      else merged.push({ id, repo, scope: 'local', branch, tip, switchTo: base });
      continue;
    }
    const held = await worktreeOf(g, branch);
    const why = held && (await keepReason(held.dir, held.locked));
    if (held && why) kept.push({ repo, branch, reason: `checked out in ${held.dir}: ${why}` });
    else merged.push({ id, repo, scope: 'local', branch, tip, ...(held && { worktree: held.dir }) });
  }
  const remotes = (await g.git('for-each-ref', '--format=%(if)%(symref)%(then)%(else)%(refname:short)%(end)', 'refs/remotes/origin/')).stdout
    .split('\n')
    .filter((r) => r.startsWith('origin/'))
    .map((r) => r.slice('origin/'.length));
  for (const branch of remotes) {
    if (protectedNames.has(branch) || !(await isMerged(g, `refs/remotes/origin/${branch}`, baseRef))) continue;
    const task = await taskOf(branch);
    if (task) kept.push({ repo, branch: `origin/${branch}`, reason: `Claudestrator task ${task} is not finished` });
    else merged.push({ id: `${repo}:origin:${branch}`, repo, scope: 'origin', branch });
  }
  return { merged, kept };
}

/** One repo: fetch, pull its default branch, and find its merged branches (none while a merge waits on conflicts). */
async function syncRepo({ repo, dir }: { repo: string; dir: string }, opts: SyncOptions): Promise<RepoSync> {
  const g = new GitRepo(dir);
  if (!(await exists(path.join(dir, '.git')))) return { repo, dir, base: null, pull: { kind: 'failed', branch: '', reason: `${dir} is not a git repository` }, merged: [], kept: [] };
  const fetched = await g.gitWith({ env: NO_PROMPT }, 'fetch', '--prune', '--quiet', 'origin');
  const warning = fetched.code === 0 ? undefined : `fetch failed, the refs already here were used: ${gitError(fetched)}`;
  const base = await defaultBranch(g);
  if (!base) return { repo, dir, base: null, pull: { kind: 'failed', branch: '', reason: "origin's default branch is not known (no origin/HEAD, main or master)" }, ...(warning && { warning }), merged: [], kept: [] };
  const pull = await pullDefault(g, base);
  const found = pull.kind === 'conflict' ? { merged: [], kept: [] } : await collectMerged(g, repo, base, opts);
  return { repo, dir, base, pull, ...(warning && { warning }), ...found };
}

/** Deletes the chosen branches of one repo: origin's in one push (one by one when it fails), then the local ones. */
async function deleteMerged(dir: string, branches: readonly MergedBranch[]): Promise<Deleted[]> {
  const g = new GitRepo(dir);
  const out: Deleted[] = [];
  const remote = branches.filter((b) => b.scope === 'origin');
  if (remote.length) {
    const all = await g.gitWith({ env: NO_PROMPT }, 'push', '--quiet', 'origin', '--delete', ...remote.map((b) => b.branch));
    for (const b of remote) {
      if (all.code === 0) {
        out.push({ id: b.id, ok: true });
        continue;
      }
      const one = await g.gitWith({ env: NO_PROMPT }, 'push', '--quiet', 'origin', '--delete', b.branch);
      out.push(one.code === 0 ? { id: b.id, ok: true } : { id: b.id, ok: false, note: `origin refused (protected? no credentials?): ${gitError(one)}` });
    }
  }
  for (const b of branches.filter((x) => x.scope === 'local')) {
    let note: string | undefined;
    if (b.switchTo) {
      const r = await g.git('switch', '--quiet', b.switchTo);
      if (r.code !== 0) {
        out.push({ id: b.id, ok: false, note: `cannot switch to ${b.switchTo}: ${gitError(r)}` });
        continue;
      }
      note = `switched to ${b.switchTo}`;
    } else if (b.worktree) {
      // Checked to hold nothing but output a build makes again: --force lets those untracked files go.
      const r = (await exists(b.worktree)) ? await g.git('worktree', 'remove', '--force', b.worktree) : await g.git('worktree', 'prune');
      if (r.code !== 0) {
        out.push({ id: b.id, ok: false, note: `cannot remove the worktree ${b.worktree}: ${gitError(r)}` });
        continue;
      }
      note = `worktree ${b.worktree} removed`;
    }
    // -D: git's -d does not know a squash or a rebase merge.
    const r = await g.git('branch', '-D', b.branch);
    out.push(r.code === 0 ? { id: b.id, ok: true, ...(note && { note }) } : { id: b.id, ok: false, note: gitError(r) });
  }
  return out;
}

/** What Claude Code is asked in a repo whose merge of the default branch stopped on conflicts. */
function conflictPrompt({ repo, dir, branch, base, files }: { repo: string; dir: string; branch: string; base: string; files: readonly string[] }): string {
  return [
    `In the repo ${repo} (${dir}), merging origin/${base} into the branch ${branch} stopped on conflicts in:`,
    ...files.map((f) => `- ${f}`),
    '',
    `Resolve every conflict so that both sides' intent survives: read what ${branch} changed (git log origin/${base}..${branch}, git diff origin/${base}...${branch}) and what ${base} changed since they parted, and keep both where they agree. Where they cannot both hold, ask me.`,
    `Then run what the repo has to check the files you touched (its tests or typecheck, if they are quick), \`git add\` the resolved files and conclude the merge with \`git commit --no-edit\`.`,
    'Do not push, do not abort the merge and do not reset anything unless I say so.',
  ].join('\n');
}

export type { SyncOptions };
export { conflictPrompt, deleteMerged, defaultBranch, isMerged, syncRepo };
