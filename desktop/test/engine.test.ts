// The engine thread's own parts: its settings file, the notifications it decides on, the terminals' script, and how it
// answers what the engine asks of an editor.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import manifest from '../../vscode/package.json';
import { defaultsFrom, openSettings, settingProblem } from '../src/engine/settings';
import { noticeFor, noticeLevel } from '../src/engine/notices';
import { terminalScript } from '../src/engine/terminal';
import { createShimHost, type SecretStore } from '../src/engine/host';
import type { EngineEvent } from '../../core/src/wire';
import type { MainRequest } from '../src/shared/protocol';
import type { TerminalSpec, Terminals } from '../src/engine/terminal';

const temp = () => mkdtempSync(join(tmpdir(), 'cs-desktop-'));

describe('settings', () => {
  const defaults = defaultsFrom(manifest);

  test('the defaults are the extension\'s own', () => {
    expect(defaults['claudestrator.notifications']).toBe('all');
    expect(defaults['claudestrator.settingSources']).toEqual(['project', 'local']);
    expect(defaults['claudestrator.workspaceFolder']).toBe('');
  });

  test('a value of the wrong shape, or an unknown key, is refused', () => {
    expect(settingProblem(defaults, 'claudestrator.notifications', 'loud')).toContain('notifications');
    expect(settingProblem(defaults, 'claudestrator.askPermissions', 'yes')).toContain('a boolean');
    expect(settingProblem(defaults, 'claudestrator.nope', 1)).toContain('unknown setting');
    expect(settingProblem(defaults, 'claudestrator.atlassian.site', 'acme.atlassian.net')).toBeNull();
    expect(settingProblem(defaults, 'claudestrator.settingSources', ['user'])).toBeNull();
  });

  test('stored values are kept, broken ones dropped, and writes land in the file', async () => {
    const dir = temp();
    try {
      const file = join(dir, 'settings.json');
      writeFileSync(file, JSON.stringify({ 'claudestrator.notifications': 'needsYou', 'claudestrator.askPermissions': 'maybe', other: 1 }));
      const store = await openSettings({ file, defaults });
      expect(store.all()['claudestrator.notifications']).toBe('needsYou');
      expect(store.all()['claudestrator.askPermissions']).toBe(false);
      await store.set('claudestrator.workspaceFolder', '/work/cs');
      await expect(store.set('claudestrator.notifications', 'loud')).rejects.toThrow();
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'claudestrator.notifications': 'needsYou', 'claudestrator.workspaceFolder': '/work/cs' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing or broken file is the defaults', async () => {
    const dir = temp();
    try {
      writeFileSync(join(dir, 'broken.json'), '{not json');
      expect((await openSettings({ file: join(dir, 'broken.json'), defaults })).all()).toEqual(defaults);
      expect((await openSettings({ file: join(dir, 'none.json'), defaults })).all()).toEqual(defaults);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('notifications', () => {
  const checkpoint = { name: 'checkpoint', data: { taskId: 'T-1', checkpoint: { id: 'approve-plan', options: [], at: '' }, title: 'Plan ready' } } as EngineEvent;
  const finished = { name: 'finished', data: { taskId: 'T-1', state: { outcome: 'published', input: 'Add validation\nto the form' } } } as EngineEvent;
  const failed = { name: 'log', data: { level: 'error', message: 'gh is not signed in', taskId: 'T-1' } } as EngineEvent;
  const info = { name: 'log', data: { level: 'info', message: 'started' } } as EngineEvent;

  test('what each level lets through', () => {
    expect(noticeFor(checkpoint, 'needsYou')).toEqual({ title: 'T-1 needs you', body: 'Plan approval: Plan ready', whenAway: true });
    expect(noticeFor(checkpoint, 'off')).toBeNull();
    expect(noticeFor(finished, 'needsYou')).toBeNull();
    expect(noticeFor(finished, 'all')).toEqual({ title: 'T-1: draft PRs are open', body: 'Add validation', whenAway: false });
    expect(noticeFor(failed, 'all')).toEqual({ title: 'T-1 failed', body: 'gh is not signed in', whenAway: true });
    expect(noticeFor(info, 'all')).toBeNull();
  });

  test('a text from a task never becomes a link', () => {
    const sneaky = { name: 'log', data: { level: 'error', message: 'see [here](command:workbench.action.reload)' } } as EngineEvent;
    expect(noticeFor(sneaky, 'all')?.body).not.toContain('](');
  });

  test('an unknown setting value counts as the default', () => {
    expect(noticeLevel('needsYou')).toBe('needsYou');
    expect(noticeLevel(undefined)).toBe('all');
    expect(noticeLevel(3)).toBe('all');
  });
});

describe('terminals', () => {
  const spec: TerminalSpec = { name: "Claude sign-in · it's me", cwd: '/home/me/my repo', env: { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: null }, command: ['/opt/claude', 'auth', 'login'] };
  const files = { statusFile: '/tmp/t/1.status', pidFile: '/tmp/t/1.pid' };

  test('the script runs the program in its folder with its variables, quoted for the shell', () => {
    const s = terminalScript(spec, files);
    expect(s).toContain("cd '/home/me/my repo' || done_ 1");
    expect(s).toContain("export PATH='/usr/bin'");
    expect(s).toContain('unset CLAUDE_CONFIG_DIR');
    expect(s).toContain("'/opt/claude' 'auth' 'login'");
    expect(s).toContain(`'Claude sign-in · it'\\''s me'`);
  });

  test('its exit code, or a signal when the window closes, goes to the status file', () => {
    const s = terminalScript(spec, files);
    expect(s).toContain("trap 'done_ 129' HUP INT TERM");
    expect(s.trimEnd().endsWith('done_ $?')).toBe(true);
    expect(s).toContain("mv '/tmp/t/1.status.tmp' '/tmp/t/1.status'");
  });

  test('without a program it is a login shell', () => {
    expect(terminalScript({ ...spec, command: null }, files)).toContain('exec "${SHELL:-/bin/sh}" -l');
  });

  test('a real script reports the program\'s exit code', async () => {
    const dir = temp();
    try {
      const f = { statusFile: join(dir, 's'), pidFile: join(dir, 'p') };
      const script = join(dir, 'run.sh');
      writeFileSync(script, terminalScript({ name: 't', cwd: dir, env: {}, command: ['sh', '-c', 'exit 7'] }, f));
      const run = Bun.spawnSync(['sh', script]);
      expect(run.exitCode).toBe(7);
      expect(readFileSync(f.statusFile, 'utf8').trim()).toBe('7');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('what the engine asks of an editor', () => {
  function host(mainAnswer: unknown = null) {
    const asked: MainRequest[] = [];
    const posts: unknown[] = [];
    const opened: [number, TerminalSpec][] = [];
    const secrets = new Map<string, string>();
    const store: SecretStore = { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => void secrets.set(k, v), delete: async (k) => void secrets.delete(k) };
    const terminals: Terminals = { open: async (id, s) => void opened.push([id, s]), close: async () => undefined, closeAll: async () => undefined };
    const settingsSet: [string, unknown][] = [];
    const h = createShimHost({
      settings: { all: () => ({}), set: async (k, v) => void settingsSet.push([k, v]) },
      terminals,
      secrets: store,
      main: async (r) => (asked.push(r), mainAnswer),
      post: (m) => void posts.push(m),
      revealDashboard: () => undefined,
    });
    return { h, asked, posts, opened, secrets, settingsSet };
  }

  test('a message without buttons is a toast on the page; with them, a message box picks one of them', async () => {
    const t = host('Remove');
    expect(await t.h.request<unknown>('showMessage', { level: 'warning', message: 'Saved', items: [] })).toBeUndefined();
    expect(t.posts).toEqual([{ type: 'toast', kind: 'warn', text: 'Saved' }]);
    expect(await t.h.request<unknown>('showMessage', { level: 'warning', message: 'Remove "api"?', modal: true, detail: 'Only the entry.', items: ['Remove'] })).toBe('Remove');
    expect(t.asked).toEqual([{ method: 'message', level: 'warning', message: 'Remove "api"?', detail: 'Only the entry.', items: ['Remove'] }]);
    expect(await host('Something else').h.request<unknown>('showMessage', { modal: true, message: 'x', items: ['Remove'] })).toBeUndefined();
  });

  test('a folder dialog: folders only, and nothing picked is undefined', async () => {
    const t = host([]);
    expect(await t.h.request<unknown>('openDialog', { canSelectFolders: true, canSelectMany: true, defaultPath: '/work', filters: { Backup: ['yaml', 'json'] } })).toBeUndefined();
    expect(t.asked).toEqual([{ method: 'openDialog', folders: true, files: false, many: true, startIn: '/work', extensions: ['yaml', 'json'] }]);
    expect(await host(['/a', 7]).h.request<unknown>('openDialog', {})).toEqual(['/a']);
  });

  test('only web links leave the app', async () => {
    const t = host();
    await t.h.request<unknown>('openExternal', { url: 'file:///etc/passwd' });
    await t.h.request<unknown>('openExternal', { url: 'https://github.com/acme/api/pull/1' });
    expect(t.asked).toEqual([{ method: 'openExternal', url: 'https://github.com/acme/api/pull/1' }]);
  });

  test('secrets stay in the worker\'s keychain; settings go to the store', async () => {
    const t = host();
    await t.h.request<unknown>('secret', { op: 'store', key: 'claudestrator.atlassianToken', value: 't0k' });
    expect(await t.h.request<unknown>('secret', { op: 'get', key: 'claudestrator.atlassianToken' })).toBe('t0k');
    await t.h.request<unknown>('secret', { op: 'delete', key: 'claudestrator.atlassianToken' });
    expect(await t.h.request<unknown>('secret', { op: 'get', key: 'claudestrator.atlassianToken' })).toBeUndefined();
    await t.h.request<unknown>('setSetting', { key: 'claudestrator.notifications', value: 'off' });
    expect(t.settingsSet).toEqual([['claudestrator.notifications', 'off']]);
    expect(t.asked).toEqual([]);
  });

  test('a terminal: its environment keeps strings and unsets, and drops what is neither', async () => {
    const t = host();
    await t.h.request<unknown>('terminalOpen', { id: 3, name: 'Claude', cwd: '/w', env: { PATH: '/bin', CLAUDE_CONFIG_DIR: null, BAD: 4 }, command: ['claude', '--resume', 'abc'] });
    expect(t.opened).toEqual([[3, { name: 'Claude', cwd: '/w', env: { PATH: '/bin', CLAUDE_CONFIG_DIR: null }, command: ['claude', '--resume', 'abc'] }]]);
  });

  test('a request it does not know, or without what it needs, fails', async () => {
    const t = host();
    await expect(t.h.request<unknown>('format', {})).rejects.toThrow('unknown request format');
    await expect(t.h.request<unknown>('openFile', {})).rejects.toThrow('path is missing');
  });
});
