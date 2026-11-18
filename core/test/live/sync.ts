// A live run of Sync against the Claude Code CLI installed here (part of `npm run test:live`; a few cents on haiku),
// on real repositories: a bare origin and a clone of it. The whole of it, with Claude Code where Sync hands it the work:
//   * the feature branch checked out gets origin's main merged in, which stops on a conflict;
//   * Claude Code, asked what "Resolve with Claude" asks it (the same prompt, here with -p instead of a terminal),
//     resolves it keeping both sides, and concludes the merge, without pushing;
//   * the next sync finds the merge done, offers the branch main already holds and not the feature branch, and
//     deletes what was offered, here and on origin.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';

import { setChildEnv } from '../../src/git';
import { conflictPrompt, deleteMerged, syncRepo } from '../../src/sync';

const MODEL = process.env.SYNC_MODEL || 'haiku';

async function main(): Promise<void> {
  const claude = process.env.CLAUDE_PATH || 'claude';
  const version = execFileSync(claude, ['--version'], { encoding: 'utf8' }).trim();
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_AUTHOR_NAME: 'live', GIT_AUTHOR_EMAIL: 'live@example.com', GIT_COMMITTER_NAME: 'live', GIT_COMMITTER_EMAIL: 'live@example.com' };
  delete env.CLAUDECODE;
  setChildEnv(env);
  const git = (dir: string, ...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' }).trim();
  const commit = (dir: string, file: string, text: string, message: string): void => {
    fs.writeFileSync(path.join(dir, file), text);
    git(dir, 'add', file);
    git(dir, 'commit', '-q', '-m', message);
  };

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-live-sync-')));
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const api = path.join(root, 'api');
  console.log(`Claude Code ${version}, ${MODEL}\nfolder: ${root}`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env });
  execFileSync('git', ['clone', '-q', origin, seed], { env, stdio: 'ignore' }); // an empty origin: git says so
  git(seed, 'checkout', '-q', '-b', 'main');
  commit(seed, 'math.mjs', 'export function one() {\n  return 1;\n}\n', 'one');
  git(seed, 'push', '-q', '-u', 'origin', 'main');
  // A branch whose pull request is merged: Sync offers it.
  git(seed, 'checkout', '-q', '-b', 'fix/done');
  commit(seed, 'README.md', '# math\n', 'readme');
  git(seed, 'push', '-q', 'origin', 'fix/done');
  git(seed, 'checkout', '-q', 'main');
  git(seed, 'merge', '-q', '--no-ff', '-m', 'Merge fix/done', 'fix/done');
  execFileSync('git', ['clone', '-q', origin, api], { env });
  // Your feature branch adds a function where main, meanwhile, adds another.
  git(api, 'checkout', '-q', '-b', 'feat/three');
  commit(api, 'math.mjs', 'export function one() {\n  return 1;\n}\n\nexport function three() {\n  return 3;\n}\n', 'three');
  commit(seed, 'math.mjs', 'export function one() {\n  return 1;\n}\n\nexport function two() {\n  return 2;\n}\n', 'two');
  git(seed, 'push', '-q', 'origin', 'main');
  const originMain = git(seed, 'rev-parse', 'origin/main');

  const results: [string, boolean, string][] = [];
  const check = (name: string, ok: boolean, detail = ''): void => void results.push([name, ok, detail]);
  const opts = { taskUnfinished: async () => false };

  const first = await syncRepo({ repo: 'api', dir: api }, opts);
  check('the sync stops on the conflict, and offers nothing meanwhile', first.pull.kind === 'conflict' && first.merged.length === 0, JSON.stringify(first.pull));
  if (first.pull.kind !== 'conflict') throw new Error('no conflict to resolve');

  // What "Resolve with Claude" asks, in the repo: a session that may edit and run git, never push.
  const prompt = conflictPrompt({ repo: 'api', dir: api, branch: first.pull.branch, base: first.pull.base, files: first.pull.files });
  const out = await new Promise<{ code: number | null; text: string }>((resolve) => {
    const child = spawn(claude, ['-p', prompt, '--model', MODEL, '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Grep,Glob,Bash(git *),Bash(node *)', '--disallowedTools', 'Bash(git push*),Bash(git merge --abort*),Bash(git reset*)'], { cwd: api, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    const timer = setTimeout(() => child.kill(), 300000);
    child.on('close', (code) => (clearTimeout(timer), resolve({ code, text })));
  });
  check('Claude Code ended on its own', out.code === 0, `exit ${out.code}: ${out.text.slice(-300)}`);
  const file = fs.readFileSync(path.join(api, 'math.mjs'), 'utf8');
  check('the merge is concluded', !fs.existsSync(path.join(api, '.git', 'MERGE_HEAD')) && git(api, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length === 3, git(api, 'log', '--oneline', '-3'));
  check('both sides are kept, with no conflict marker left', /function two\(\)/.test(file) && /function three\(\)/.test(file) && /function one\(\)/.test(file) && !/^(<{7}|={7}|>{7})/m.test(file), file);
  let parses = true;
  try {
    execFileSync(process.execPath, ['--check', path.join(api, 'math.mjs')], { stdio: 'ignore' });
  } catch {
    parses = false;
  }
  check('the file it left parses', parses);
  check('nothing was pushed', git(seed, 'ls-remote', 'origin', 'refs/heads/main').startsWith(originMain) && git(seed, 'ls-remote', '--heads', 'origin', 'feat/three') === '');
  check('the working tree is clean', git(api, 'status', '--porcelain', '--untracked-files=no') === '', git(api, 'status', '--short'));

  const second = await syncRepo({ repo: 'api', dir: api }, opts);
  const offered = second.merged.map((b) => `${b.scope}:${b.branch}`).sort();
  check('the next sync finds the merge done', second.pull.kind === 'up-to-date', JSON.stringify(second.pull));
  check('it offers the merged branch, and not the feature branch with work of its own', JSON.stringify(offered) === JSON.stringify(['origin:fix/done']), offered.join(', '));
  const deleted = await deleteMerged(api, second.merged);
  check('what it offered is deleted from origin', deleted.every((d) => d.ok) && git(seed, 'ls-remote', '--heads', 'origin', 'fix/done') === '', JSON.stringify(deleted));
  check('the feature branch stays', git(api, 'branch', '--show-current') === 'feat/three');

  for (const [name, ok, detail] of results) console.log(`${ok ? '✔' : '✖'} ${name}${detail && !ok ? ` (${detail})` : ''}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
  else fs.rmSync(root, { recursive: true, force: true });
}

main().catch((e: Error) => {
  console.error(e);
  process.exitCode = 1;
});
