// The extension's commands as VS Code runs them: activate() with a stand-in for `vscode`, then a command of the menus.
import test from 'node:test';
import * as assert from 'node:assert/strict';
import Module from 'module';

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Whatever the extension asks of `vscode` and the test does not care about: callable, constructible, every member
 * itself again. What the test reads is set over it.
 */
const anything: unknown = new Proxy(function () {}, {
  get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : anything),
  apply: () => anything,
  construct: () => anything as object,
  // A status bar item's name, a webview's html: set, and forgotten.
  set: () => true,
});
const commands = new Map<string, (...args: unknown[]) => unknown>();
const panels: { title: string }[] = [];
const vscodeStub = new Proxy(
  {
    commands: { registerCommand: (name: string, fn: (...args: unknown[]) => unknown) => (commands.set(name, fn), { dispose() {} }), executeCommand: async () => undefined },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => undefined, update: async () => {} }), onDidChangeConfiguration: () => ({ dispose() {} }), onDidChangeWorkspaceFolders: () => ({ dispose() {} }), createFileSystemWatcher: () => anything },
    window: new Proxy({ createWebviewPanel: (_id: string, title: string) => (panels.push({ title }), anything) }, { get: (t, k: string) => (k in t ? (t as Record<string, unknown>)[k] : anything) }),
    Uri: { file: (fsPath: string) => ({ fsPath }), joinPath: () => anything, parse: () => anything },
  },
  { get: (t, k: string) => (k in t ? (t as Record<string, unknown>)[k] : anything) }
);
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === 'vscode' ? vscodeStub : load.call(this, request, ...rest);
};
const extension = require('../extension') as typeof import('../extension');

test('extension: Open in Tab on a task opens the dashboard on it, with a tab of its own; Open Task without one', async () => {
  const context = {
    subscriptions: [] as { dispose(): unknown }[],
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    globalState: { get: () => undefined, update: async () => {} },
    extensionUri: { fsPath: '/ext' },
    extension: { packageJSON: { version: '0.0.0' } },
  } as unknown as import('vscode').ExtensionContext;
  const api = extension.activate(context) as unknown as { DashboardPanel: { current?: { initialRoute?: unknown; navigate(route: unknown): void; dispose(): void } } };
  try {
    assert.ok(commands.has('claudestrator.openTaskInTab'), 'registered');
    // From the dashboard's menu on a task (its data-vscode-context), as from the sidebar's.
    await commands.get('claudestrator.openTaskInTab')!({ webviewSection: 'task', taskId: 'PROJ-1', taskStatus: 'running' });
    assert.equal(panels.length, 1, 'the dashboard opened');
    assert.deepEqual(api.DashboardPanel.current!.initialRoute, { name: 'task', taskId: 'PROJ-1', tab: true }, 'the page starts on it, in a tab');

    // Open Task, with the dashboard open: no tab, and no second dashboard.
    const current = api.DashboardPanel.current!;
    const went: unknown[] = [];
    current.navigate = (route) => void went.push(route);
    await commands.get('claudestrator.openTask')!({ webviewSection: 'task', taskId: 'PROJ-2' });
    await commands.get('claudestrator.openTaskInTab')!({ webviewSection: 'task', taskId: 'PROJ-3' });
    assert.deepEqual(went, [{ name: 'task', taskId: 'PROJ-2' }, { name: 'task', taskId: 'PROJ-3', tab: true }]);
    assert.equal(panels.length, 1);
  } finally {
    api.DashboardPanel.current?.dispose();
    for (const d of context.subscriptions) d.dispose();
    loader._load = load;
  }
});
