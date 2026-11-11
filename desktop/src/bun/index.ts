// The desktop app's main thread: the window with the dashboard, the menu, native dialogs and notifications. The
// engine runs in a worker (src/engine/worker.ts, bundled to engine/worker.js), started first so it loads while the
// window opens; nothing here waits for it.
import { homedir } from 'node:os';
import { join } from 'node:path';
// The SDK's parts one by one, not its index: that one also loads WebGPU and the updater, which the app never uses.
import * as ApplicationMenu from 'electrobun/bun/app-menu';
import { BrowserView } from 'electrobun/bun/browser-view';
import { BrowserWindow } from 'electrobun/bun/browser-window';
import { BuildConfig } from 'electrobun/bun/build-config';
import events from 'electrobun/bun/events';
import { Screen } from 'electrobun/bun/native';
import { RESOURCES_FOLDER } from 'electrobun/bun/paths';
import * as Utils from 'electrobun/bun/utils';
import pkg from '../../package.json';
import { LOG_FILE, type FromEngine, type ToEngine } from '../shared/protocol';
import type { DashboardRPC, PageMessage } from '../shared/rpc';
import type { Route } from '../../../core/src/wire';
import { placeFrame, readFrame, frameSaver, type Frame } from './frame';
import { appMenu, clickedAction, type MenuAction } from './menu';
import { answer } from './requests';

/** Where the app keeps its settings, the engine's small state and its log (Application Support on macOS). */
const storageDir = Utils.paths.userData;
/** The Claudestrator directory until one is chosen in Settings: its config, tasks, plans and worktrees. */
const defaultRoot = join(homedir(), 'Claudestrator');
const REPO_URL = 'https://github.com/yurii-bondar/claudestrator';
/** How long agents get to stop cleanly when the app quits (the JetBrains sidecar gives them as long). */
const QUIT_GRACE_MS = 5000;

// ---------- the engine ----------

const engine = new Worker(join(RESOURCES_FOLDER, 'app', 'engine', 'worker.js'));
const toEngine = (msg: ToEngine): void => engine.postMessage(msg);
toEngine({ type: 'init', storageDir, defaultRoot, version: pkg.version });

engine.onmessage = (event: MessageEvent<FromEngine>) => void fromEngine(event.data);
engine.onerror = (e) => {
  console.error('[desktop] the engine stopped', e.message);
  void Utils.showMessageBox({ type: 'error', title: 'Claudestrator', message: 'The engine stopped.', detail: `${e.message}\n\nThe log: ${join(storageDir, LOG_FILE)}`, buttons: ['OK'] });
};

async function fromEngine(msg: FromEngine): Promise<void> {
  switch (msg.type) {
    case 'ready':
      return;
    case 'fatal':
      console.error('[desktop] the engine could not start', msg.message);
      await Utils.showMessageBox({ type: 'error', title: 'Claudestrator', message: 'Claudestrator could not start.', detail: msg.message, buttons: ['OK'] });
      return;
    case 'posts':
      // One RPC message for the batch: one encryption and one socket frame, however much an agent streamed.
      return void page?.rpc.send.host(msg.msgs);
    case 'revealDashboard':
      return openWindow();
    case 'notify':
      if (msg.notice.whenAway && focused) return;
      return Utils.showNotification({ title: msg.notice.title, body: msg.notice.body });
    case 'req':
      try {
        toEngine({ type: 'res', id: msg.id, ok: true, data: await answer(msg.request) });
      } catch (e) {
        toEngine({ type: 'res', id: msg.id, ok: false, error: (e as Error).message });
      }
      return;
    case 'stopped':
      return finishQuit();
    default: {
      const unhandled: never = msg;
      return unhandled;
    }
  }
}

// ---------- the window ----------

const frameFile = join(storageDir, 'window.json');
const saveFrame = frameSaver(frameFile);
const displays = Screen.getAllDisplays();
let frame: Frame = placeFrame(await readFrame(frameFile), displays.map((d) => d.workArea), displays.find((d) => d.isPrimary)?.workArea);
let page: { win: BrowserWindow; rpc: ReturnType<typeof dashboardRpc> } | undefined;
let focused = false;

function dashboardRpc() {
  return BrowserView.defineRPC<DashboardRPC>({
    handlers: { requests: {}, messages: { page: (msg: PageMessage) => toEngine({ type: 'page', msg }) } },
  });
}

/** Shows the dashboard: the window in front, on `route` when given; a closed window opens again. */
function openWindow(route?: Route): void {
  if (page) {
    page.win.show();
    page.win.activate();
    if (route) toEngine({ type: 'dashboard', route, reveal: true });
    return;
  }
  const rpc = dashboardRpc();
  const win = new BrowserWindow({ title: 'Claudestrator', url: 'views://dashboard/index.html', frame, rpc });
  page = { win, rpc };
  win.on('close', () => {
    page = undefined;
    focused = false;
    toEngine({ type: 'dashboardClosed' });
    // On macOS the app stays, and its agents keep working: the Dock icon opens the window again.
    if (process.platform !== 'darwin') Utils.quit();
  });
  win.on('focus', () => (focused = true));
  win.on('blur', () => (focused = false));
  win.on('resize', (e) => moved(e, true));
  win.on('move', (e) => moved(e, false));
  toEngine({ type: 'dashboard', ...(route && { route }), reveal: true });
}

function moved(event: unknown, sized: boolean): void {
  const d = typeof event === 'object' && event !== null ? (event as { data?: Partial<Frame> }).data : undefined;
  if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') return;
  frame = { ...frame, x: d.x, y: d.y, ...(sized && typeof d.width === 'number' && typeof d.height === 'number' && { width: d.width, height: d.height }) };
  saveFrame(frame);
}

// ---------- the menu ----------

const { isPackaged } = BuildConfig.getSync();
ApplicationMenu.setApplicationMenu(appMenu({ devTools: !isPackaged }));
ApplicationMenu.on('application-menu-clicked', (event) => {
  const action = clickedAction(event);
  if (action) onMenu(action);
});

function onMenu(action: MenuAction): void {
  switch (action.kind) {
    case 'go':
      return openWindow({ name: action.screen });
    case 'newTask':
      return openWindow({ name: 'home', compose: '' });
    case 'command':
      openWindow();
      return toEngine({ type: 'command', command: action.command });
    case 'reload':
      return page?.win.webview.loadURL('views://dashboard/index.html');
    case 'devTools':
      return page?.win.webview.toggleDevTools();
    case 'showLog':
      Utils.openPath(join(storageDir, LOG_FILE));
      return;
    case 'help':
      Utils.openExternal(REPO_URL);
      return;
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

// ---------- the app ----------

// The Dock icon with no window open.
events.on('reopen', () => openWindow());

/**
 * Quitting stops the agents first, so their tasks resume from the same step next time: the first quit is held until
 * the engine says they stopped (or QUIT_GRACE_MS passed), then the app quits for real.
 */
let quit: 'no' | 'stopping' | 'go' = 'no';
events.on('before-quit', (event: { response?: { allow: boolean } }) => {
  if (quit === 'go') return;
  event.response = { allow: false };
  if (quit === 'stopping') return;
  quit = 'stopping';
  toEngine({ type: 'shutdown' });
  setTimeout(finishQuit, QUIT_GRACE_MS);
});

function finishQuit(): void {
  if (quit === 'go') return;
  quit = 'go';
  Utils.quit();
}

// The app opens on Start: which Claude account the agents run under (the first time, only the tile that adds one).
openWindow({ name: 'start' });
