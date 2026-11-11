// The app's menu: what VS Code's command palette and the JetBrains plugin's Tools menu offer, plus the Edit menu
// without which the page's text fields get no copy and paste on macOS.
import type { ApplicationMenuItemConfig } from 'electrobun/bun/app-menu';
import type { Command } from '../shared/protocol';

/** What a menu item does. Shortcuts are single keys: with ⌘ on macOS, Ctrl elsewhere. */
export type MenuAction =
  | { kind: 'go'; screen: Screen }
  | { kind: 'newTask' }
  | { kind: 'command'; command: Command }
  | { kind: 'reload' }
  | { kind: 'devTools' }
  | { kind: 'showLog' }
  | { kind: 'help' };

/** The dashboard's screens, as its side rail names them (core/page/app.ts, NAV), and Start, where the account is chosen. */
export type Screen = 'home' | 'agents' | 'scenarios' | 'repos' | 'mcp' | 'settings' | 'start';

const SCREENS: readonly (readonly [Screen, string, string])[] = [
  ['home', 'Tasks', '1'],
  ['agents', 'Agents', '2'],
  ['scenarios', 'Scenarios', '3'],
  ['repos', 'Repos & Checks', '4'],
  ['mcp', 'Integrations', '5'],
  ['settings', 'Settings', '6'],
];

const divider = { type: 'divider' } as const;

/** Menu items carry their action as `data`; the click event hands it back. */
const item = (label: string, action: MenuAction, accelerator?: string): ApplicationMenuItemConfig => ({ label, action: 'cs', data: action, ...(accelerator && { accelerator }) });

export function appMenu({ devTools }: { devTools: boolean }): ApplicationMenuItemConfig[] {
  return [
    {
      label: 'Claudestrator',
      submenu: [{ role: 'about' }, divider, item('Settings…', { kind: 'go', screen: 'settings' }, ','), item('Switch Account…', { kind: 'go', screen: 'start' }), divider, { role: 'hide' }, { role: 'hideOthers' }, { role: 'showAll' }, divider, { role: 'quit' }],
    },
    {
      label: 'File',
      submenu: [
        item('New Task', { kind: 'newTask' }, 'n'),
        divider,
        item('Choose Claudestrator Directory…', { kind: 'command', command: 'pickRoot' }),
        item('Reveal Claudestrator Directory', { kind: 'command', command: 'revealRoot' }),
        item('Open config.yaml', { kind: 'command', command: 'openConfig' }),
        item('Add Work Directories…', { kind: 'go', screen: 'repos' }),
        divider,
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, divider, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        ...SCREENS.map(([screen, label, key]) => item(label, { kind: 'go', screen }, key)),
        divider,
        item('Reload', { kind: 'reload' }, 'r'),
        ...(devTools ? [item('Developer Tools', { kind: 'devTools' })] : []),
        divider,
        { role: 'toggleFullScreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, divider, { role: 'bringAllToFront' }] },
    { label: 'Help', submenu: [item('Show Log', { kind: 'showLog' }), item('Claudestrator on GitHub', { kind: 'help' })] },
  ];
}

/** The action of a click, from Electrobun's event (`{ data: { action, data } }`); null for anything else. */
export function clickedAction(event: unknown): MenuAction | null {
  const data = isRecord(event) && isRecord(event.data) ? event.data.data : undefined;
  if (!isRecord(data) || typeof data.kind !== 'string') return null;
  switch (data.kind) {
    case 'go':
      return data.screen === 'start' || SCREENS.some(([s]) => s === data.screen) ? { kind: 'go', screen: data.screen as Screen } : null;
    case 'command':
      return data.command === 'pickRoot' || data.command === 'revealRoot' || data.command === 'openConfig' ? { kind: 'command', command: data.command } : null;
    case 'newTask':
    case 'reload':
    case 'devTools':
    case 'showLog':
    case 'help':
      return { kind: data.kind };
    default:
      return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
