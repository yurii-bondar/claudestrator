// The window's engines: the current one, and one replaced (the workspace folder changed) while its task still runs.
import test from 'node:test';
import * as assert from 'node:assert/strict';
import Module from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Engine } from '../../core/src/engine';
import type { PermissionRequest } from '../../core/src/wire';

// orchestrator.ts loads `vscode`; these methods never reach it.
/* eslint-disable @typescript-eslint/no-require-imports */
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = loader._load;
/** What orchestrator.ts gets as `vscode`: settings, read from `setting` (a test sets the ones it needs). */
let setting: Record<string, unknown> = {};
const vscodeStub = { workspace: { getConfiguration: () => ({ get: (key: string) => setting[key] }) } };
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === 'vscode' ? vscodeStub : load.call(this, request, ...rest);
};
const { Orchestrator } = require('../src/orchestrator') as typeof import('../src/orchestrator');
loader._load = load;

/** An engine as far as routing reads it: what runs in it and the questions it waits on. */
function engine(running: string[], waiting: PermissionRequest[]) {
  const answered: string[] = [];
  const stopped: string[] = [];
  const e = {
    running: new Set(running),
    pendingPermissions: () => waiting,
    permissionReply: (id: string) => (waiting.some((w) => w.requestId === id) ? (answered.push(id), true) : false),
    stop: async (taskId: string) => void stopped.push(taskId),
  };
  return { e: e as unknown as Engine, answered, stopped };
}

test('orchestrator: a question of a replaced engine\'s agent is listed and answered, and its task is stopped there', async () => {
  const ask = (requestId: string, taskId: string) => ({ requestId, taskId, agent: 'developer', tool: 'Bash', input: {}, at: 0 }) as PermissionRequest;
  const current = engine(['NEW-1'], [ask('r-new', 'NEW-1')]);
  const old = engine(['OLD-1'], [ask('r-old', 'OLD-1')]);
  const orch = Object.assign(Object.create(Orchestrator.prototype) as InstanceType<typeof Orchestrator>, { engine: current.e, retired: [old.e] });

  assert.deepEqual(orch.pendingPermissions().map((p) => p.requestId), ['r-new', 'r-old']);
  assert.equal(orch.permissionReply('r-old', true), true);
  assert.deepEqual(old.answered, ['r-old'], 'the engine that asked answers it');
  assert.equal(orch.permissionReply('gone', true), false);
  assert.equal(orch.engineOf('OLD-1'), old.e);
  assert.equal(orch.engineOf('NEW-1'), current.e);
  await orch.engineOf('OLD-1')!.stop('OLD-1');
  assert.deepEqual(old.stopped, ['OLD-1']);
});

test('orchestrator: rebuilds of the engine run one after another, and a failed one does not stop the next', async () => {
  const log: string[] = [];
  let n = 0;
  const orch = Object.assign(Object.create(Orchestrator.prototype) as InstanceType<typeof Orchestrator>, { rebuilding: Promise.resolve() });
  // What each rebuild does is its own business here; only their order is.
  (orch as unknown as { rebuildNow: () => Promise<void> }).rebuildNow = async () => {
    const i = ++n;
    log.push(`start ${i}`);
    await new Promise((r) => setTimeout(r, 20 - i * 5));
    log.push(`end ${i}`);
    if (i === 2) throw new Error('the folder went away');
  };
  const runs = [orch.rebuild(), orch.rebuild(), orch.rebuild()];
  const results = await Promise.allSettled(runs);
  assert.deepEqual(log, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3'], 'never two at once, even when a later one would finish first');
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
});

test('orchestrator: an MCP check shows the configured servers once it starts, and two refreshes start one check', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-orch-mcp-'));
  const account = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-orch-acct-'));
  fs.writeFileSync(path.join(account, '.claude.json'), JSON.stringify({ mcpServers: { Grafana: { type: 'http', url: 'http://g' } } }));
  fs.writeFileSync(path.join(ws, '.mcp.json'), JSON.stringify({ mcpServers: { sentry: { type: 'sse', url: 'https://s' } } }));
  let checks = 0;
  const orch = Object.assign(Object.create(Orchestrator.prototype) as InstanceType<typeof Orchestrator>, {
    root: ws,
    mcp: { servers: [], checking: false, checkedAt: null, error: null },
    agentEnv: () => ({ CLAUDE_CONFIG_DIR: account }),
    fire: () => {},
  });
  // The check itself runs `claude mcp list`; here it only counts.
  (orch as unknown as { checkMcp: () => Promise<void> }).checkMcp = async () => void checks++;
  await Promise.all([orch.refreshMcp(), orch.refreshMcp()]);
  assert.deepEqual(orch.mcp.servers.map((s) => s.name), ['Grafana', 'sentry']);
  assert.equal(orch.mcp.checking, true);
  assert.equal(checks, 1);
});

test('orchestrator: a new account gets the next free ~/.claude-<n>, is chosen and signed in to; a sign-in that does not finish puts the old one back', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-orch-home-'));
  fs.mkdirSync(path.join(home, '.claude-2')); // taken: the next one is -3
  setting = { claudeConfigDir: '/accounts/before' };
  const chosen: (string | null | undefined)[] = [];
  let then: ((ok: boolean) => unknown) | undefined;
  const orch = Object.assign(Object.create(Orchestrator.prototype) as InstanceType<typeof Orchestrator>, {
    claudeLoginTerminal: null,
    setAccount: async (dir?: string | null) => void chosen.push(dir),
    claudeLogin: (fn?: (ok: boolean) => unknown) => void (then = fn),
  });
  try {
    const dir = await orch.addAccount(home);
    assert.equal(dir, path.join(home, '.claude-3'));
    assert.ok(fs.statSync(dir).isDirectory());
    assert.deepEqual(chosen, [dir]);
    await then!(false);
    assert.deepEqual(chosen, [dir, '/accounts/before'], 'the account it had before');
    assert.equal(fs.existsSync(dir), false, 'the empty folder goes');

    const kept = await orch.addAccount(home);
    await then!(true);
    assert.ok(fs.existsSync(kept), 'signed in: the account stays');
    assert.equal(chosen.at(-1), kept);

    Object.assign(orch, { claudeLoginTerminal: { exitStatus: undefined } });
    await assert.rejects(orch.addAccount(home), /sign-in is open already/);
  } finally {
    setting = {};
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('orchestrator: removing an account signs out in each of its folders, leaves them off the list and moves the agents to another', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-orch-rm-'));
  // A `claude` that writes down where it signed out (its CLAUDE_CONFIG_DIR) and what it was asked.
  const log = path.join(dir, 'log');
  const claude = path.join(dir, 'claude');
  fs.writeFileSync(claude, `#!/bin/sh\necho "\${CLAUDE_CONFIG_DIR:-default} $*" >> '${log}'\n`, { mode: 0o755 });
  const state = new Map<string, unknown>();
  const chosen: (string | null | undefined)[] = [];
  const home = path.join(os.homedir(), '.claude');
  const listed = [
    { dir: home, label: 'claude', email: 'me@x.dev', current: false, loggedIn: true },
    { dir: '/acc/.claude-work', label: 'work', email: 'me@x.dev', current: true, loggedIn: true },
    { dir: '/acc/.claude-b', label: 'b', email: 'b@x.dev', current: false, loggedIn: true },
  ];
  const orch = Object.assign(Object.create(Orchestrator.prototype) as InstanceType<typeof Orchestrator>, {
    context: { globalState: { get: (k: string) => state.get(k), update: async (k: string, v: unknown) => void state.set(k, v) } },
    auth: new Map([[home, { loggedIn: true }]]),
    accounts: async () => listed,
    ensureReady: async () => undefined,
    claudeCommand: () => claude,
    accountChoice: () => ({ shownDir: '/acc/.claude-work' }),
    setAccount: async (d?: string | null) => void chosen.push(d),
    fire: () => {},
  });
  try {
    await orch.removeAccount([home, '/acc/.claude-work', '/not/an/account']);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['default auth logout', '/acc/.claude-work auth logout'], 'the default folder signs out without CLAUDE_CONFIG_DIR');
    assert.deepEqual(orch.removedAccounts(), [home, '/acc/.claude-work']);
    assert.deepEqual(chosen, ['/acc/.claude-b'], 'the agents ran under it: they move to the account left');
    assert.equal(orch.auth.has(home), false);
    await assert.rejects(orch.removeAccount(['/not/an/account']), /No such Claude Code account/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
