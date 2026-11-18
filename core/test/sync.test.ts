// Syncing repos with their default branch, on real repositories: a bare origin and a clone of it, with branches
// merged every way a pull request is (a merge, a squash, a rebase), one with work of its own, one a task still needs.
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { conflictPrompt, deleteMerged, isMerged, syncRepo } from '../src/sync';
import type { RepoSync } from '../src/wire';
import { GitRepo, setChildEnv } from '../src/git';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
// What the sync itself runs commits merges too: with an identity of its own, whatever this machine's git config says.
setChildEnv(ENV);
const git = (dir: string, ...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { env: ENV, encoding: 'utf8' }).trim();
const write = (dir: string, file: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
/** A commit of one file on what is checked out. */
const commit = (dir: string, file: string, text: string, message = `change ${file}`): void => {
  write(dir, file, text);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', message);
};

/** An origin with main, a clone of it (`api`), and a second clone to push to origin from, as a teammate would. */
function repos() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-sync-')));
  const origin = path.join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: ENV });
  const seed = path.join(root, 'seed');
  execFileSync('git', ['clone', '-q', origin, seed], { env: ENV });
  git(seed, 'checkout', '-q', '-b', 'main');
  commit(seed, 'app.js', 'const a = 1;\n');
  git(seed, 'push', '-q', '-u', 'origin', 'main');
  const api = path.join(root, 'api');
  execFileSync('git', ['clone', '-q', origin, api], { env: ENV });
  return { root, origin, seed, api };
}

/** The sync of the clone, with these tasks unfinished. */
const sync = (dir: string, unfinished: string[] = []): Promise<RepoSync> => syncRepo({ repo: 'api', dir }, { taskUnfinished: async (id) => unfinished.includes(id) });
const names = (r: RepoSync) => r.merged.map((b) => `${b.scope}:${b.branch}`).sort();

test('sync: a branch merged by a merge, a squash or a rebase is offered, locally and on origin; one with work of its own is not', async () => {
  const { seed, api } = repos();
  // Pushed from the seed: branches as pull requests leave them, then main moves on with their work.
  for (const b of ['merged', 'squashed', 'rebased', 'open']) {
    git(seed, 'checkout', '-q', '-b', b, 'main');
    commit(seed, `${b}.js`, `export const ${b} = 1;\n`);
    if (b === 'rebased') commit(seed, `${b}-2.js`, 'export const two = 2;\n');
    git(seed, 'push', '-q', 'origin', b);
  }
  git(seed, 'checkout', '-q', 'main');
  git(seed, 'merge', '-q', '--no-ff', '-m', 'Merge merged', 'merged');
  git(seed, 'merge', '-q', '--squash', 'squashed');
  git(seed, 'commit', '-q', '-m', 'squashed (#2)');
  git(seed, 'cherry-pick', 'main..rebased');
  git(seed, 'push', '-q', 'origin', 'main');

  git(api, 'fetch', '-q');
  for (const b of ['merged', 'squashed', 'rebased', 'open']) git(api, 'branch', '-q', b, `origin/${b}`);
  const r = await sync(api);
  assert.equal(r.base, 'main');
  assert.deepEqual(r.pull, { kind: 'updated', branch: 'main', from: r.pull.kind === 'updated' ? r.pull.from : '', to: git(api, 'rev-parse', '--short', 'HEAD') });
  assert.deepEqual(names(r), ['local:merged', 'local:rebased', 'local:squashed', 'origin:merged', 'origin:rebased', 'origin:squashed'], 'not open, and never main');
  assert.equal(r.merged.find((b) => b.id === 'api:local:merged')!.tip, git(api, 'rev-parse', '--short', 'merged'), 'its tip, to bring it back');
  assert.equal(await isMerged(new GitRepo(api), 'refs/heads/open', 'refs/remotes/origin/main'), false);
});

test('sync: a feature branch gets the default branch merged in; a conflict is left for Claude Code, with nothing offered meanwhile', async () => {
  const { seed, api } = repos();
  git(api, 'checkout', '-q', '-b', 'feat/x');
  commit(api, 'app.js', 'const a = 2;\n');
  commit(seed, 'other.js', 'x\n');
  git(seed, 'push', '-q', 'origin', 'main');

  const clean = await sync(api);
  assert.equal(clean.pull.kind, 'merged', JSON.stringify(clean.pull));
  assert.ok(fs.existsSync(path.join(api, 'other.js')), "main's change is in the feature branch");
  assert.equal(git(api, 'rev-parse', 'main'), git(api, 'rev-parse', 'origin/main'), 'the local main moved too');

  commit(seed, 'app.js', 'const a = 3;\n');
  git(seed, 'push', '-q', 'origin', 'main');
  const stopped = await sync(api);
  assert.deepEqual(stopped.pull, { kind: 'conflict', branch: 'feat/x', base: 'main', files: ['app.js'] });
  assert.deepEqual(stopped.merged, []);
  assert.ok(fs.existsSync(path.join(api, '.git', 'MERGE_HEAD')), 'the merge waits to be resolved');
  assert.deepEqual((await sync(api)).pull, stopped.pull, 'a sync before it is resolved says so again');

  const prompt = conflictPrompt({ repo: 'api', dir: api, branch: 'feat/x', base: 'main', files: ['app.js'] });
  assert.match(prompt, /merging origin\/main into the branch feat\/x stopped on conflicts in:\n- app\.js/);
  assert.match(prompt, /Do not push, do not abort the merge/);

  write(api, 'app.js', 'const a = 4;\n');
  git(api, 'commit', '-q', '-am', 'wip');
  write(api, 'app.js', 'dirty\n');
  assert.deepEqual((await sync(api)).pull, { kind: 'skipped', branch: 'feat/x', reason: 'uncommitted changes to tracked files' });
});

test('sync: a merged branch checked out stays unless the checkout can go; a task that still needs its branch keeps it', async () => {
  const { seed, api } = repos();
  git(api, 'checkout', '-q', '-b', 'feat/done');
  commit(api, 'done.js', 'export const done = 1;\n');
  git(api, 'push', '-q', 'origin', 'feat/done');
  git(seed, 'fetch', '-q');
  git(seed, 'merge', '-q', '--no-ff', '-m', 'Merge feat/done', 'origin/feat/done');
  git(seed, 'push', '-q', 'origin', 'main');
  git(api, 'branch', '-q', 'feat/task', 'feat/done');
  git(api, 'config', 'branch.feat/task.claudestratorTask', 'CP-1');
  git(api, 'branch', '-q', 'feat/wt', 'feat/done');
  const wt = path.join(path.dirname(api), 'wt');
  git(api, 'worktree', 'add', '-q', wt, 'feat/wt');
  write(wt, 'notes.txt', 'mine\n');
  write(api, 'scratch.txt', 'mine too\n');

  let r = await sync(api, ['CP-1']);
  assert.deepEqual(r.kept.map((k) => [k.branch, k.reason.replace(wt, '<wt>')]).sort(), [
    ['feat/done', 'checked out here: untracked files: scratch.txt'],
    ['feat/task', 'Claudestrator task CP-1 is not finished'],
    ['feat/wt', 'checked out in <wt>: untracked files: notes.txt'],
  ]);
  assert.deepEqual(names(r), ['origin:feat/done']);

  fs.rmSync(path.join(api, 'scratch.txt'));
  fs.rmSync(path.join(wt, 'notes.txt'));
  fs.mkdirSync(path.join(wt, 'node_modules', 'x'), { recursive: true });
  r = await sync(api);
  assert.deepEqual(names(r), ['local:feat/done', 'local:feat/task', 'local:feat/wt', 'origin:feat/done'], 'a finished task, and output a build makes again, hold nothing back');
  const done = r.merged.find((b) => b.id === 'api:local:feat/done')!;
  assert.equal(done.switchTo, 'main');
  assert.equal(r.merged.find((b) => b.id === 'api:local:feat/wt')!.worktree, wt);

  const results = await deleteMerged(api, r.merged);
  assert.ok(results.every((x) => x.ok), JSON.stringify(results));
  assert.equal(results.find((x) => x.id === done.id)!.note, 'switched to main');
  assert.equal(git(api, 'branch', '--show-current'), 'main');
  assert.equal(git(api, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'), 'main');
  assert.ok(!fs.existsSync(wt), 'its worktree went with it');
  assert.equal(git(seed, 'ls-remote', '--heads', 'origin', 'feat/done'), '', 'gone from origin');
});

/** Pushes a branch from the seed: made from `from` with one commit of `file`. */
function pushBranch(seed: string, { name, from = 'main', file, text }: { name: string; from?: string; file: string; text: string }): void {
  git(seed, 'checkout', '-q', '-b', name, from);
  commit(seed, file, text);
  git(seed, 'push', '-q', 'origin', name);
  git(seed, 'checkout', '-q', 'main');
}

/** Whether origin's `branch` counts as merged into origin's main, as the clone sees it after a fetch. */
async function mergedOnOrigin(api: string, branch: string): Promise<boolean> {
  git(api, 'fetch', '-q', '--prune');
  return isMerged(new GitRepo(api), `refs/remotes/origin/${branch}`, 'refs/remotes/origin/main');
}

test('sync: an early draft of what main holds in a later form counts as merged; a branch that went elsewhere does not', async () => {
  const { seed, api } = repos();
  commit(seed, 'calc.js', 'x\n');
  git(seed, 'push', '-q', 'origin', 'main');
  pushBranch(seed, { name: 'draft', file: 'calc.js', text: 'x\nconst total = sum(a)\n' });
  pushBranch(seed, { name: 'elsewhere', file: 'calc.js', text: 'x\nconst total = 0\n' });
  // main reworks the line the draft added: merging the draft only conflicts, and adds nothing main lacks.
  commit(seed, 'calc.js', 'x\nconst total = sum(a) + tax(b)\n');
  git(seed, 'push', '-q', 'origin', 'main');
  assert.equal(await mergedOnOrigin(api, 'draft'), true);
  assert.equal(await mergedOnOrigin(api, 'elsewhere'), false, 'its 0 is nowhere in main');
});

test('sync: an older point of a branch main holds counts as merged, and so does a stack level squashed into the PR above it', async () => {
  const { seed, api } = repos();
  commit(seed, 'f.txt', 'x\n');
  git(seed, 'push', '-q', 'origin', 'main');

  // older → newer, which reworks older's line; newer is squash-merged. older's own merge would only conflict.
  pushBranch(seed, { name: 'older', file: 'f.txt', text: 'x\none\n' });
  pushBranch(seed, { name: 'newer', from: 'older', file: 'f.txt', text: 'x\ntwo\n' });
  git(seed, 'merge', '-q', '--squash', 'newer');
  git(seed, 'commit', '-q', '-m', 'newer (#1)');
  git(seed, 'push', '-q', 'origin', 'main');
  assert.equal(await mergedOnOrigin(api, 'older'), true, 'newer holds it, and newer adds nothing to main');
  // The stack rule below would also find it (newer has its commit); without it, the branch that holds it is enough.
  assert.equal(await isMerged(new GitRepo(api), 'refs/remotes/origin/older', 'refs/remotes/origin/main', true), true);

  // low is squash-merged into high (the PR above it), high reworks low's line and is squash-merged into main.
  commit(seed, 's.txt', 'x\n');
  git(seed, 'push', '-q', 'origin', 'main');
  pushBranch(seed, { name: 'low', file: 's.txt', text: 'x\nalpha beta\n' });
  git(seed, 'checkout', '-q', '-b', 'high', 'main');
  git(seed, 'merge', '-q', '--squash', 'low');
  git(seed, 'commit', '-q', '-m', 'low (#2)');
  commit(seed, 's.txt', 'x\nalpha gamma\n');
  git(seed, 'push', '-q', 'origin', 'high');
  git(seed, 'checkout', '-q', 'main');
  git(seed, 'merge', '-q', '--squash', 'high');
  git(seed, 'commit', '-q', '-m', 'high (#3)');
  git(seed, 'push', '-q', 'origin', 'main');
  assert.equal(await mergedOnOrigin(api, 'low'), true, 'high holds a commit with its very tree, and high is in main');
});

test('sync: a main with commits of its own is not merged or rebased, only reported', async () => {
  const { seed, api } = repos();
  commit(api, 'mine.txt', 'mine\n');
  commit(seed, 'theirs.txt', 'theirs\n');
  git(seed, 'push', '-q', 'origin', 'main');
  const r = await sync(api);
  assert.deepEqual(r.pull, { kind: 'failed', branch: 'main', reason: 'main has commits of its own and cannot fast-forward to origin/main' });
  assert.ok(!fs.existsSync(path.join(api, 'theirs.txt')));
});

test("sync: origin's branches go in one push, and one by one when that fails, each with its own outcome", async () => {
  const { seed, api } = repos();
  for (const name of ['feat/a', 'feat/b']) pushBranch(seed, { name, file: `${name.slice(5)}.txt`, text: `${name}\n` });
  for (const name of ['feat/a', 'feat/b']) git(seed, 'merge', '-q', '--no-ff', '-m', `Merge ${name}`, name);
  git(seed, 'push', '-q', 'origin', 'main');
  const r = await sync(api);
  assert.deepEqual(names(r), ['origin:feat/a', 'origin:feat/b']);
  // Someone deletes feat/b before you do: the push of both fails, and each is tried on its own.
  git(seed, 'push', '-q', 'origin', '--delete', 'feat/b');
  const results = await deleteMerged(api, r.merged);
  assert.deepEqual(results.map((x) => [x.id, x.ok]), [['api:origin:feat/a', true], ['api:origin:feat/b', false]]);
  assert.match(results[1]!.note!, /^origin refused \(protected\? no credentials\?\)/);
  assert.equal(git(seed, 'ls-remote', '--heads', 'origin', 'feat/a'), '');
});
