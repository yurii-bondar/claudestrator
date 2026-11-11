// The engine's thread: the VS Code extension's host code (vscode/src/orchestrator.ts and panel.ts, unchanged) on the
// `vscode` stand-in (core/src/vscode-shim.ts), as the JetBrains sidecar runs it. Its own event loop: a native dialog
// open on the main thread holds up no agent, hook or watcher. What only the main thread can do it asks for
// (MainRequest); what the dashboard says goes both ways through it.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as shim from '../../../core/src/vscode-shim';
import * as view from '../../../core/src/view';
import { Orchestrator } from '../../../vscode/src/orchestrator';
import { DashboardPanel, openConfig } from '../../../vscode/src/panel';
import type { Route } from '../../../core/src/wire';
import manifest from '../../../vscode/package.json';
import { LOG_FILE, type Command, type FromEngine, type MainRequest, type ToEngine } from '../shared/protocol';
import { createShimHost, keychain } from './host';
import { noticeFor, noticeLevel } from './notices';
import { defaultsFrom, openSettings } from './settings';
import { createTerminals, type Terminals } from './terminal';

declare const self: Worker;

const send = (msg: FromEngine): void => self.postMessage(msg);

// ---------- to the page: what is posted in one turn of the loop crosses to the main thread at once ----------

let outbox: unknown[] = [];
function post(msg: unknown): void {
  if (!outbox.length) setImmediate(flush);
  outbox.push(msg);
}
function flush(): void {
  const msgs = outbox;
  outbox = [];
  if (msgs.length) send({ type: 'posts', msgs });
}

// ---------- to the main thread: requests and their answers ----------

let nextId = 1;
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

function main(request: MainRequest): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ type: 'req', id, request });
  });
}

function answered(msg: Extract<ToEngine, { type: 'res' }>): void {
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.data);
  else p.reject(new Error(msg.error || 'request failed'));
}

// ---------- the engine ----------

interface Started {
  orch: Orchestrator;
  context: shim.ExtensionContext;
  terminals: Terminals;
}
let started: Started | undefined;

const vscodeContext = (c: shim.ExtensionContext): ConstructorParameters<typeof Orchestrator>[0] => c as unknown as ConstructorParameters<typeof Orchestrator>[0];

async function start(msg: Extract<ToEngine, { type: 'init' }>): Promise<Started> {
  const settings = await openSettings({ file: path.join(msg.storageDir, 'settings.json'), defaults: defaultsFrom(manifest) });
  const terminals = createTerminals({ dir: path.join(msg.storageDir, 'terminals'), onExit: (id, code) => shim.terminalClosed(id, code) });
  shim.setHost(createShimHost({ settings, terminals, secrets: keychain, main, post, revealDashboard: () => send({ type: 'revealDashboard' }) }));
  shim.setSettings(settings.all(), []);
  // The Claudestrator directory: the one chosen in Settings, else the default, made on first use.
  if (!settings.all()['claudestrator.workspaceFolder']) await fs.mkdir(msg.defaultRoot, { recursive: true });
  shim.setWorkspaceFolders([msg.defaultRoot]);
  const context = shim.createContext({ storageDir: msg.storageDir, extensionDir: import.meta.dir, version: msg.version });
  const orch = new Orchestrator(vscodeContext(context));

  // What VS Code's output channel shows, in a file (Help → Show Log), and what it shows as notifications.
  const log = await openLog(path.join(msg.storageDir, LOG_FILE));
  orch.onEngine((e) => {
    if (e.name === 'log') log(e.data);
    const notice = noticeFor(e, noticeLevel(settings.all()['claudestrator.notifications']));
    if (notice) send({ type: 'notify', notice });
  });
  // As extension.ts does: a new directory is a new engine, a new CLI is checked again.
  shim.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('claudestrator.workspaceFolder')) void orch.rebuild();
    if (e.affectsConfiguration('claudestrator.claudePath')) void orch.refreshHealth();
    else if (e.affectsConfiguration('claudestrator.settingSources')) void orch.refreshDefaults(true);
  });
  await orch.init();
  return { orch, context, terminals };
}

/** Appends lines as the engine logs them; a log grown past LOG_MAX starts over. */
const LOG_MAX = 5 * 1024 * 1024;
async function openLog(file: string): Promise<(data: { level: string; message: string; taskId?: string }) => void> {
  const size = await fs.stat(file).then((s) => s.size, () => 0);
  // Each line is one append (O_APPEND): lines of concurrent events never interleave.
  const sink = await fs.open(file, size > LOG_MAX ? 'w' : 'a');
  return (data) => {
    const { level, text } = view.logLine(data);
    void sink.appendFile(`${new Date().toISOString()} ${level.padEnd(5)} ${text}\n`).catch(() => undefined);
  };
}

function dashboard(s: Started, route: Route | undefined, reveal: boolean): DashboardPanel {
  const show = (): DashboardPanel => DashboardPanel.show(vscodeContext(s.context), s.orch, route);
  // A page already on screen (a new engine for it) is attached without being brought forward.
  return reveal ? show() : shim.quietly(show);
}

async function command(s: Started, c: Command): Promise<void> {
  switch (c) {
    case 'pickRoot':
      await dashboard(s, { name: 'settings', section: 'workspace' }, true).$pickWorkspace();
      return;
    case 'revealRoot':
      if (s.orch.root) await main({ method: 'reveal', path: s.orch.root });
      return;
    case 'openConfig':
      if (s.orch.root) await openConfig(s.orch.root, 'project');
      return;
    default: {
      const unhandled: never = c;
      return unhandled;
    }
  }
}

async function handle(s: Started, msg: Exclude<ToEngine, { type: 'init' | 'res' }>): Promise<void> {
  switch (msg.type) {
    case 'page':
      return shim.deliverPageMessage(msg.msg);
    case 'dashboard':
      dashboard(s, msg.route, msg.reveal);
      return;
    case 'dashboardClosed':
      return shim.closeDashboard();
    case 'command':
      return command(s, msg.command).catch((e: Error) => post({ type: 'toast', kind: 'error', text: e.message }));
    case 'shutdown':
      // Agents stopped cleanly resume from the same step next time. Terminals are the user's: they stay open.
      await s.orch.stopAll().catch((e: Error) => console.error('[engine] stopping failed', e.message));
      flush();
      return send({ type: 'stopped' });
    default: {
      const unhandled: never = msg;
      return unhandled;
    }
  }
}

// What arrives before the engine has started waits for it, in order: the window opens without waiting.
let early: Exclude<ToEngine, { type: 'init' | 'res' }>[] | null = [];

self.onmessage = (event: MessageEvent<ToEngine>) => {
  const msg = event.data;
  if (msg.type === 'res') return answered(msg);
  if (msg.type === 'init') {
    start(msg).then(
      (s) => {
        started = s;
        send({ type: 'ready' });
        const waiting = early ?? [];
        early = null;
        for (const m of waiting) void handle(s, m);
      },
      (e: Error) => send({ type: 'fatal', message: e.stack || e.message })
    );
    return;
  }
  if (!started || early) {
    early?.push(msg);
    return;
  }
  void handle(started, msg).catch((e: Error) => console.error('[engine]', msg.type, e.stack || e.message));
};

process.on('unhandledRejection', (e) => console.error('[engine] unhandled rejection', e));
