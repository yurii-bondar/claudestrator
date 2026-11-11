// The `vscode` stand-in the JetBrains sidecar and the desktop app run the engine's host code on: what it asks of its
// host, and what it keeps itself (settings, the dashboard's messages).
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as shim from '../src/vscode-shim';

interface Call {
  method: string;
  params: unknown;
}

/** A host that records what it is asked and answers each request with `answer(method)`. */
function fakeHost(answer: (method: string) => unknown = () => null) {
  const calls: Call[] = [];
  const posts: unknown[] = [];
  let reveals = 0;
  shim.setHost({
    request: async <T>(method: string, params: unknown) => {
      calls.push({ method, params });
      return answer(method) as T;
    },
    post: (msg) => posts.push(msg),
    revealDashboard: () => void reveals++,
  });
  return { calls, posts, reveals: () => reveals };
}

test('a message with buttons asks the host, and returns the button picked', async () => {
  const h = fakeHost(() => 'Remove');
  const picked = await shim.window.showWarningMessage('Remove "api"?', { modal: true, detail: 'Only the config entry.' }, 'Remove');
  assert.equal(picked, 'Remove');
  assert.deepEqual(h.calls, [{ method: 'showMessage', params: { level: 'warning', message: 'Remove "api"?', modal: true, detail: 'Only the config entry.', items: ['Remove'] } }]);
});

test('a setting written by the engine goes to the host, then reads back and tells the listeners', async () => {
  const h = fakeHost();
  shim.setSettings({ 'claudestrator.notifications': 'all' }, []);
  const seen: boolean[] = [];
  const sub = shim.workspace.onDidChangeConfiguration((e) => seen.push(e.affectsConfiguration('claudestrator.workspaceFolder')));
  await shim.workspace.getConfiguration('claudestrator').update('workspaceFolder', '/work/claudestrator');
  sub.dispose();
  assert.deepEqual(h.calls, [{ method: 'setSetting', params: { key: 'claudestrator.workspaceFolder', value: '/work/claudestrator' } }]);
  assert.equal(shim.workspace.getConfiguration('claudestrator').get('workspaceFolder'), '/work/claudestrator');
  assert.equal(shim.workspace.getConfiguration('claudestrator').get('notifications'), 'all', 'the other settings stay');
  assert.deepEqual(seen, [true]);
});

test('the dashboard: what the engine posts goes to the host, what the page sends reaches the panel until it closes', () => {
  const h = fakeHost();
  const panel = shim.window.createWebviewPanel() as { webview: { postMessage(m: unknown): Promise<boolean>; onDidReceiveMessage(fn: (m: unknown) => void): unknown }; onDidDispose(fn: () => void): unknown };
  assert.equal(h.reveals(), 1, 'a new panel is brought forward');
  const received: unknown[] = [];
  let disposed = false;
  panel.webview.onDidReceiveMessage((m) => received.push(m));
  panel.onDidDispose(() => (disposed = true));
  void panel.webview.postMessage({ type: 'changed' });
  shim.deliverPageMessage({ type: 'req', id: 1, method: 'boot' });
  shim.closeDashboard();
  shim.deliverPageMessage({ type: 'req', id: 2, method: 'boot' });
  assert.deepEqual(h.posts, [{ type: 'changed' }]);
  assert.deepEqual(received, [{ type: 'req', id: 1, method: 'boot' }]);
  assert.ok(disposed);
});

test('a panel made quietly (for a page already on screen) is not brought forward', () => {
  const h = fakeHost();
  shim.quietly(() => shim.window.createWebviewPanel());
  assert.equal(h.reveals(), 0);
});

test('a status bar message shows on the page, as a toast', () => {
  const h = fakeHost();
  shim.window.setStatusBarMessage('report.md links images on the web: opened as text');
  assert.deepEqual(h.posts, [{ type: 'toast', kind: 'info', text: 'report.md links images on the web: opened as text' }]);
});

test('a terminal: opened through the host, closed when the host says its process ended', async () => {
  const h = fakeHost();
  const closed: (number | undefined)[] = [];
  const sub = shim.window.onDidCloseTerminal((t) => closed.push(t.exitStatus?.code));
  const t = shim.window.createTerminal({ name: 'Claude sign-in', shellPath: '/usr/local/bin/claude', shellArgs: ['auth', 'login'], cwd: '/home/me', env: { CLAUDE_CONFIG_DIR: null } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.calls[0], { method: 'terminalOpen', params: { id: t.id, name: 'Claude sign-in', cwd: '/home/me', env: { CLAUDE_CONFIG_DIR: null }, command: ['/usr/local/bin/claude', 'auth', 'login'] } });
  shim.terminalClosed(t.id, 0);
  shim.terminalClosed(t.id, 1); // told twice: heard once
  sub.dispose();
  assert.deepEqual(closed, [0]);
});

test('the extension context keeps global state in a file, and secrets with the host', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'));
  try {
    const h = fakeHost((method) => (method === 'secret' ? 'token-1' : null));
    const ctx = shim.createContext({ storageDir: dir, extensionDir: '/app', version: '1.2.3' });
    await ctx.globalState.update('limits', { pct: 31 });
    assert.deepEqual(shim.createContext({ storageDir: dir, extensionDir: '/app', version: '1.2.3' }).globalState.get('limits'), { pct: 31 });
    assert.equal(await ctx.secrets.get('claudestrator.atlassian.token'), 'token-1');
    assert.deepEqual(h.calls, [{ method: 'secret', params: { op: 'get', key: 'claudestrator.atlassian.token' } }]);
    assert.equal(ctx.extension.packageJSON.version, '1.2.3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
