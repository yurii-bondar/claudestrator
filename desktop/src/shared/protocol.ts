// The desktop app is one Bun process with two threads. The main thread (src/bun) has the window, the menus and the
// native dialogs, which are synchronous calls into the OS: while one is open, that thread waits. The engine
// (src/engine: vscode/src/orchestrator.ts and panel.ts on core/src/vscode-shim.ts) runs in a worker, so agents, the
// hook server and file watching never wait for a dialog. These are the messages between the two (the page has its
// own channel to the main thread: rpc.ts).
import type { Route } from '../../../core/src/wire';

/** The engine's log, in the app's data folder (what VS Code shows in its Claudestrator output channel). */
export const LOG_FILE = 'claudestrator.log';

/** Main thread → engine worker. */
export type ToEngine =
  | { type: 'init'; storageDir: string; defaultRoot: string; version: string }
  | { type: 'page'; msg: unknown }
  /** Opens the dashboard (or brings it forward) on a route. `reveal: false` re-attaches a page already on screen. */
  | { type: 'dashboard'; route?: Route; reveal: boolean }
  | { type: 'dashboardClosed' }
  | { type: 'command'; command: Command }
  | { type: 'res'; id: number; ok: boolean; data?: unknown; error?: string }
  | { type: 'shutdown' };

/** What the app menu asks of the engine besides showing a screen. */
export type Command = 'pickRoot' | 'revealRoot' | 'openConfig';

/** Engine worker → main thread. */
export type FromEngine =
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  /** Messages for the page, as many as were posted in one turn of the worker's loop. */
  | { type: 'posts'; msgs: unknown[] }
  | { type: 'revealDashboard' }
  | { type: 'notify'; notice: Notice }
  | { type: 'req'; id: number; request: MainRequest }
  /** Agents stopped (their tasks resume from the same step): the app may quit. */
  | { type: 'stopped' };

/** A desktop notification: the engine decides what to say, the main thread whether to show it. */
export interface Notice {
  title: string;
  body: string;
  /** Only while the window is not in front: the dashboard shows the same thing itself. */
  whenAway: boolean;
}

/** What only the main thread can do: native dialogs, the clipboard, handing a path or a link to the OS. */
export type MainRequest =
  /** A modal message box; the answer is the button picked, or null for Cancel. */
  | { method: 'message'; level: 'info' | 'warning' | 'error'; message: string; detail: string; items: string[] }
  /** The answer is the paths picked, or null. */
  | { method: 'openDialog'; folders: boolean; files: boolean; many: boolean; startIn: string; extensions: string[] }
  | { method: 'openPath'; path: string }
  | { method: 'reveal'; path: string }
  | { method: 'openExternal'; url: string }
  | { method: 'clipboard'; text: string };
