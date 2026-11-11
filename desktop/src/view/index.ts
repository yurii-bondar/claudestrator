// What the dashboard page (core/page) was written for, answered by the desktop app: `acquireVsCodeApi()` posts to the
// main thread over Electrobun's RPC, the host's messages arrive as `message` events, and the theme follows the
// system's appearance. Runs first in <body>, before the page's scripts and before anything is painted.
import { Electroview } from 'electrobun/view';
import type { DashboardRPC, PageMessage } from '../shared/rpc';

declare global {
  interface Window {
    __csHost?: 'desktop';
    acquireVsCodeApi?: () => { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };
  }
}

const rpc = Electroview.defineRPC<DashboardRPC>({
  handlers: {
    requests: {},
    messages: {
      host: (msgs: unknown[]) => {
        for (const data of msgs) window.dispatchEvent(new MessageEvent('message', { data }));
      },
    },
  },
});
new Electroview({ rpc });

window.__csHost = 'desktop';

const isMessage = (m: unknown): m is PageMessage => typeof m === 'object' && m !== null && !Array.isArray(m);

/** The page's state (route, drafts) survives a reload (View → Reload), as VS Code keeps a webview's. */
const STATE_KEY = 'claudestrator.state';
window.acquireVsCodeApi = () => ({
  postMessage: (message: unknown) => {
    if (isMessage(message)) rpc.send.page(message);
  },
  getState: () => {
    try {
      const s = sessionStorage.getItem(STATE_KEY);
      return s ? (JSON.parse(s) as unknown) : undefined;
    } catch {
      return undefined;
    }
  },
  setState: (state: unknown) => {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // storage full or off: the state lives until the page reloads
    }
  },
});

// The theme: the page reads VS Code's body classes (core/page/app.css), the palette keys on <html data-theme> (theme.css).
const dark = matchMedia('(prefers-color-scheme: dark)');
const more = matchMedia('(prefers-contrast: more)');
const THEMES = {
  dark: 'vscode-dark',
  light: 'vscode-light',
  'hc-dark': 'vscode-high-contrast',
  'hc-light': 'vscode-high-contrast vscode-high-contrast-light',
} as const;
function applyTheme(): void {
  const theme: keyof typeof THEMES = more.matches ? (dark.matches ? 'hc-dark' : 'hc-light') : dark.matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.body.className = THEMES[theme];
}
applyTheme();
dark.addEventListener('change', applyTheme);
more.addEventListener('change', applyTheme);
