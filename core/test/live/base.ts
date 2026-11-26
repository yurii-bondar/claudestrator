// A live run of a task started from a branch other than the one checked out, against the Claude Code CLI installed
// here (`npm run test:live`; it costs a few cents): on haiku at low effort, a planner and a developer. Origin has main
// and release/2.x, where `limit` is 20; you sit on wip, a branch of your own where it is 99. The task says
// `--base release/2.x`. It checks what a fake CLI cannot: that a real planner, told its checkout is not where the task
// branch starts, reads the start and plans against it; and that the branch the developer works on is release/2.x,
// with nothing of wip on it.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { Engine } from '../../src/engine';
import { ClaudeRunner, parseFlags } from '../../src/runner';
import { HookServer } from '../../src/hookserver';
import { setChildEnv } from '../../src/git';
import type { TranscriptItem } from '../../src/wire';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const commit = (dir: string, files: Record<string, string>, message: string): void => {
  for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), body);
  git(dir, 'add', '.');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message);
};

/** The repo, on wip; its origin (outside it) has main and release/2.x. */
function workspace(): { ws: string; origin: string } {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-live-base-')));
  const origin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-live-base-origin-')));
  git(origin, 'init', '-q', '--bare');
  git(ws, 'init', '-q', '-b', 'main');
  commit(ws, { 'package.json': `${JSON.stringify({ name: 'bets', version: '1.0.0', private: true }, null, 2)}\n`, 'config.js': 'export const limit = 10;\n' }, 'init');
  git(ws, 'remote', 'add', 'origin', origin);
  git(ws, 'push', '-q', 'origin', 'main');
  git(ws, 'switch', '-q', '-c', 'release/2.x');
  commit(ws, { 'config.js': 'export const limit = 20;\n', 'RELEASE.md': '# 2.x\n' }, 'release 2.x');
  git(ws, 'push', '-q', 'origin', 'release/2.x');
  git(ws, 'switch', '-q', 'main');
  git(ws, 'branch', '-q', '-D', 'release/2.x');
  git(ws, 'switch', '-q', '-c', 'wip');
  commit(ws, { 'config.js': 'export const limit = 99;\n', 'WIP.md': 'not merged anywhere\n' }, 'wip');
  fs.mkdirSync(path.join(ws, '.claudestrator'));
  fs.writeFileSync(
    path.join(ws, '.claudestrator', 'config.yaml'),
    `repos:
  app:
    path: .
pipeline: [planner, developer]
agents:
  planner: { model: haiku, effort: low }
  developer: { model: haiku, effort: low }
limits: { budgetUsd: 1, gateAttempts: 2, reviewRounds: 1 }
`
  );
  return { ws, origin };
}

const TASK = 'In config.js, add the one-line comment `// max bets per round` directly above the `limit` export, and change nothing else. In the summary of the plan, write the value `limit` has now, as `limit=<value>`. --base release/2.x';

async function main(): Promise<void> {
  const claude = process.env.CLAUDE_PATH || 'claude';
  const version = execFileSync(claude, ['--version'], { encoding: 'utf8' }).trim();
  const flags = parseFlags(execFileSync(claude, ['--help'], { encoding: 'utf8' }));
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_AUTHOR_NAME: 'live', GIT_AUTHOR_EMAIL: 'live@example.com', GIT_COMMITTER_NAME: 'live', GIT_COMMITTER_EMAIL: 'live@example.com' };
  delete env.CLAUDECODE;
  setChildEnv(env);
  const { ws, origin } = workspace();
  const wipBefore = git(ws, 'rev-parse', 'wip');
  console.log(`Claude Code ${version}\nworkspace: ${ws}`);

  const hooks = new HookServer();
  await hooks.listen();
  const runner = new ClaudeRunner({ command: () => claude, version: () => version, flags: () => flags, settingSources: () => ['project', 'local'], env: () => ({}) });
  const engine = new Engine({ workspace: ws, runner, hooks });
  const prompts: string[] = [];
  engine.on('output', ({ item }: { item: TranscriptItem }) => {
    if (item.type === 'prompt') prompts.push(String(item.text));
    if (item.type === 'tool_use') console.log(`  · ${String(item.name)} ${JSON.stringify(item.input).slice(0, 140)}`);
    if (item.type === 'blocked') console.log(`  ✋ ${String(item.tool)}: ${String(item.reason)}`);
  });
  engine.on('log', (l: { level: string; message: string }) => console.log(`  [${l.level}] ${l.message}`));

  const results: [string, boolean, string][] = [];
  const check = (name: string, ok: boolean, detail = ''): void => void results.push([name, ok, detail]);
  try {
    const { taskId } = await engine.start({ text: TASK });
    check('the task keeps the branch it starts from', (await engine.svc.state(taskId)).baseBranch === 'release/2.x');
    let s = await engine.run(taskId);
    const err = engine.lastError(taskId);
    check('the task waits for the plan', Boolean(s && s.checkpoint && s.checkpoint.id === 'approve-plan'), err ? `${err.code}: ${err.message}` : s && s.checkpoint ? s.checkpoint.id : String(s && s.status));
    if (!s || !s.checkpoint || s.checkpoint.id !== 'approve-plan') throw new Error('stopped before the plan');

    const planner = prompts.find((p) => /You are the `planner` stage/.test(p)) ?? '';
    check('the planner was told where the branch starts and that the checkout is not it', /its task branch starts from origin\/release\/2\.x at [0-9a-f]{10}; the checkout there is NOT that: on wip/.test(planner) && /Plan against where each task branch starts/.test(planner), (planner.match(/- app at [^\n]+/) || ['no line for app'])[0]!.slice(0, 220));
    const notes = (await engine.svc.events(taskId)).flatMap((e) => (e.type === 'note' ? [e.message] : []));
    check('the log notes the checkout was elsewhere', notes.some((m) => /Planned with app on wip, not where the task branch starts \(origin\/release\/2\.x\)/.test(m)), notes.join(' | ').slice(0, 200));
    check('the plan starts app from release/2.x', s.repos.some((r) => r.name === 'app' && r.baseBranch === 'release/2.x'), JSON.stringify(s.repos));
    const plan = fs.readFileSync(path.join(engine.svc.dir(taskId), s.artifacts.find((a) => a.output === 'plan')!.path), 'utf8');
    const said = (plan.match(/limit\s*=\s*`?(\d+)/) || [])[1];
    check('the planner read the start, not the checkout (limit=20, not 99)', said === '20', said ? `limit=${said}${/99/.test(plan) ? '; the plan mentions 99 too' : ''}` : 'no limit=<value> in the plan');

    await engine.answer(taskId, 'approve-plan', 'approve');
    for (let i = 0; i < 3000 && engine.isRunning(taskId); i++) await new Promise((r) => setTimeout(r, 100));
    s = await engine.svc.state(taskId);
    check('the task reaches the push question', Boolean(s.checkpoint && s.checkpoint.id === 'confirm-push'), s.checkpoint ? s.checkpoint.id : `${s.status} ${engine.lastError(taskId)?.message ?? ''}`);
    if (s.checkpoint && s.checkpoint.id === 'confirm-push') {
      const ctx = await engine.checkpointContext(s, s.checkpoint);
      check('its PR would go into release/2.x', Boolean(ctx.repos && ctx.repos.length === 1 && ctx.repos[0]!.base === 'release/2.x'), JSON.stringify(ctx.repos?.map((r) => [r.name, r.base, r.files])));
      await engine.answer(taskId, 'confirm-push', 'local');
      for (let i = 0; i < 100 && engine.isRunning(taskId); i++) await new Promise((r) => setTimeout(r, 100));
    }
    const branch = git(ws, 'branch', '--show-current');
    const onRelease = (() => {
      try {
        git(ws, 'merge-base', '--is-ancestor', 'origin/release/2.x', 'HEAD');
        return true;
      } catch {
        return false;
      }
    })();
    check('the task branch starts from origin/release/2.x', onRelease && git(ws, 'rev-list', '--count', 'origin/release/2.x..HEAD') === '1', `${branch}: ${git(ws, 'log', '--oneline', '-3').split('\n').join(' | ')}`);
    check('nothing of wip is on it', fs.existsSync(path.join(ws, 'RELEASE.md')) && !fs.existsSync(path.join(ws, 'WIP.md')));
    const config = fs.readFileSync(path.join(ws, 'config.js'), 'utf8');
    check('the developer changed the release code', /\/\/ max bets per round\s*\n\s*export const limit = 20;/.test(config), JSON.stringify(config));
    check('wip is as it was', git(ws, 'rev-parse', 'wip') === wipBefore);
    const spent = await engine.spentUsd(taskId);
    check('cost is reported', spent > 0, `$${spent.toFixed(3)}`);
  } finally {
    hooks.dispose();
    fs.rmSync(origin, { recursive: true, force: true });
  }
  for (const [name, ok, detail] of results) console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` (${detail})` : ''}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
}

main().catch((e: Error) => {
  console.error(e);
  process.exitCode = 1;
});
