// What the engine asks of an editor (core/src/vscode-shim.ts makes the requests), answered by the desktop app: in the
// worker what needs no window (settings, secrets, terminals, a toast), on the main thread the rest (native dialogs,
// the clipboard, handing a path or a link to the OS). The requests are the ones the JetBrains plugin answers
// (jetbrains/…/engine/HostRequests.kt); their parameters arrive untyped and are narrowed here.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { ShimHost } from '../../../core/src/vscode-shim';
import type { MainRequest } from '../shared/protocol';
import type { SettingsStore } from './settings';
import type { TerminalSpec, Terminals } from './terminal';

/** Secrets (the Atlassian and Bitbucket tokens), in the system's keychain. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const SERVICE = 'Claudestrator';

export const keychain: SecretStore = {
  get: (name) => Bun.secrets.get({ service: SERVICE, name }),
  set: (name, value) => Bun.secrets.set({ service: SERVICE, name, value }),
  delete: async (name) => void (await Bun.secrets.delete({ service: SERVICE, name })),
};

export interface HostDeps {
  settings: SettingsStore;
  terminals: Terminals;
  secrets: SecretStore;
  /** Asks the main thread. */
  main(request: MainRequest): Promise<unknown>;
  /** A message for the page. */
  post(msg: unknown): void;
  revealDashboard(): void;
}

type Params = Record<string, unknown>;
const str = (p: Params, k: string): string | undefined => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
const bool = (p: Params, k: string): boolean => p[k] === true;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const need = (p: Params, k: string): string => {
  const v = str(p, k);
  if (v === undefined) throw new Error(`${k} is missing`);
  return v;
};

/** The extensions of a dialog's filters: `{ 'Claudestrator backup': ['yaml', 'json'] }` → `['yaml', 'json']`. */
const extensionsOf = (filters: unknown): string[] => (typeof filters === 'object' && filters !== null ? Object.values(filters).flatMap(strings) : []);

export function createShimHost(deps: HostDeps): ShimHost {
  const handlers: Record<string, (p: Params) => Promise<unknown>> = {
    async showMessage(p) {
      const level = p.level === 'error' || p.level === 'warning' ? p.level : 'info';
      const message = str(p, 'message') ?? '';
      const items = strings(p.items);
      // VS Code's toast without buttons: the page's own, which goes away by itself.
      if (!bool(p, 'modal') && !items.length) {
        deps.post({ type: 'toast', kind: level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info', text: message });
        return undefined;
      }
      const picked = await deps.main({ method: 'message', level, message, detail: str(p, 'detail') ?? '', items });
      return typeof picked === 'string' && items.includes(picked) ? picked : undefined;
    },
    async openDialog(p) {
      const folders = bool(p, 'canSelectFolders');
      const picked = await deps.main({ method: 'openDialog', folders, files: p.canSelectFiles === undefined ? !folders : bool(p, 'canSelectFiles'), many: bool(p, 'canSelectMany'), startIn: str(p, 'defaultPath') ?? '', extensions: extensionsOf(p.filters) });
      const paths = strings(picked);
      return paths.length ? paths : undefined;
    },
    async saveDialog(p) {
      const wanted = str(p, 'defaultPath') ?? '';
      if (process.platform === 'darwin') return saveDialogMac({ title: str(p, 'title') ?? 'Save', wanted });
      // No native save dialog here: a folder, and the file name the engine proposed.
      const folder = strings(await deps.main({ method: 'openDialog', folders: true, files: false, many: false, startIn: path.dirname(wanted), extensions: [] }))[0];
      return folder ? path.join(folder, path.basename(wanted) || 'claudestrator') : null;
    },
    async openFile(p) {
      await deps.main({ method: 'openPath', path: need(p, 'path') });
      return null;
    },
    async reveal(p) {
      await deps.main({ method: 'reveal', path: need(p, 'path') });
      return null;
    },
    async openExternal(p) {
      // Links come from the engine's own data (a PR address, a docs link); only web links leave the app.
      const url = need(p, 'url');
      if (/^https?:\/\//i.test(url)) await deps.main({ method: 'openExternal', url });
      return null;
    },
    async clipboard(p) {
      await deps.main({ method: 'clipboard', text: str(p, 'text') ?? '' });
      return null;
    },
    async secret(p) {
      const key = need(p, 'key');
      switch (p.op) {
        case 'get':
          return (await deps.secrets.get(key)) ?? undefined;
        case 'store':
          return deps.secrets.set(key, str(p, 'value') ?? '');
        case 'delete':
          return deps.secrets.delete(key);
        default:
          throw new Error('secret: unknown operation');
      }
    },
    async setSetting(p) {
      await deps.settings.set(need(p, 'key'), p.value);
      return null;
    },
    async terminalOpen(p) {
      const id = p.id;
      if (typeof id !== 'number') throw new Error('id is missing');
      const env = typeof p.env === 'object' && p.env !== null ? Object.entries(p.env) : [];
      const spec: TerminalSpec = {
        name: str(p, 'name') ?? 'Claudestrator',
        cwd: str(p, 'cwd') ?? '',
        env: Object.fromEntries(env.filter((e): e is [string, string | null] => e[1] === null || typeof e[1] === 'string')),
        command: Array.isArray(p.command) ? strings(p.command) : null,
      };
      await deps.terminals.open(id, spec);
      return null;
    },
    // The system's terminal is its own app: it is in front already, as it opened.
    async terminalShow() {
      return null;
    },
    async terminalSend() {
      throw new Error('Claudestrator does not type into terminals here');
    },
    async terminalClose(p) {
      if (typeof p.id === 'number') await deps.terminals.close(p.id);
      return null;
    },
  };

  return {
    request: async <T>(method: string, params: unknown): Promise<T> => {
      const handler = Object.prototype.hasOwnProperty.call(handlers, method) ? handlers[method] : undefined;
      if (!handler) throw new Error(`unknown request ${method}`);
      return (await handler(typeof params === 'object' && params !== null ? (params as Params) : {})) as T;
    },
    post: deps.post,
    revealDashboard: deps.revealDashboard,
  };
}

/** macOS's own save panel, from another process: this thread never waits on it, nor does the window's. */
function saveDialogMac({ title, wanted }: { title: string; wanted: string }): Promise<string | null> {
  const folder = path.dirname(wanted);
  const script = ['on run argv', `set f to choose file name with prompt (item 1 of argv) default name (item 2 of argv)${existsSync(folder) ? ' default location (POSIX file (item 3 of argv))' : ''}`, 'return POSIX path of f', 'end run'];
  return new Promise((resolve) => {
    execFile('osascript', [...script.flatMap((l) => ['-e', l]), title, path.basename(wanted) || 'claudestrator', folder], (e, out) => resolve(e ? null : out.trim() || null));
  });
}
