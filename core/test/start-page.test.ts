// The start screen (page/start.ts), run as the page runs it: the compiled script on a `window` of its own, with the
// shell (window.CS) reduced to what records what the screen draws, asks the host, and where it goes.
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

interface Entry {
  dir: string;
  label: string;
  email?: string;
  current: boolean;
  loggedIn?: boolean;
  plan?: string;
}

/** A tile of the page as the drag and key handlers see it: its key, and `closest` finding itself. */
class Element {
  dataset: Record<string, string>;
  constructor(key: string) {
    this.dataset = { key };
  }
  closest(): Element {
    return this;
  }
  classList = { add() {}, remove() {}, contains: () => false };
}

type Handler = (e: Record<string, unknown>) => void;

async function startScreen(accounts: Entry[], order: string[] = [], aliases: Record<string, string> = {}, answers: Record<string, unknown> = {}) {
  let html = '';
  const asked: [string, unknown][] = [];
  const went: unknown[] = [];
  const handlers: Record<string, Handler> = {};
  const region = { addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn) };
  let data = { current: {}, accounts, signingIn: false, order, aliases };
  let loads = 0;
  const views: Record<string, { enter(r: unknown): Promise<void>; actions: Record<string, (el: unknown) => unknown>; changes: Record<string, (el: unknown) => unknown> }> = {};
  const aliasInput = { focused: false, focus() { this.focused = true; }, select() {} };
  const known: Record<string, unknown> = {
    views,
    LOGO: '<svg></svg>',
    accountKey: (a: { email?: string; dir: string }) => (a.email ? a.email.toLowerCase() : `dir:${a.dir}`),
    esc: (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    icon: (name: string) => `<i data-icon="${name}"></i>`,
    patch: (_region: string, h: string) => ((html = h), true),
    call: async (method: string) => (method === 'accounts' ? (loads++, data) : {}),
    attempt: async (method: string, params: unknown) => {
      asked.push([method, JSON.parse(JSON.stringify(params ?? null))]);
      return method in answers ? answers[method] : true;
    },
    go: async (route: unknown) => void went.push(JSON.parse(JSON.stringify(route))),
    $: (sel: string) => (sel === '[data-region="start"]' ? region : sel === '.acc-alias' ? aliasInput : { innerHTML: '' }),
    $$: () => [],
  };
  const CS = new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : () => '') });
  const script = fs.readFileSync(path.join(__dirname, '..', 'page', 'start.js'), 'utf8');
  vm.runInNewContext(script, { window: { CS }, Element });
  await views.start!.enter({ name: 'start' });
  /** The tiles' keys, in the order the page shows them. */
  const keys = () => [...html.matchAll(/class="acc-tile[^"]*" data-key="([^"]+)"/g)].map((m) => m[1]);
  const fire = (type: string, e: Record<string, unknown>) => handlers[type]!({ preventDefault() {}, ...e });
  /** What the host answers from now on (as after a change it made). */
  const hostHas = (next: Partial<typeof data>) => void (data = { ...data, ...next });
  return { html: () => html, keys, asked, went, fire, view: views.start!, aliasInput, loads: () => loads, hostHas };
}

const ME = '/Users/me';

test('start: the first time there is only the tile that adds an account, on its own', async () => {
  const s = await startScreen([]);
  assert.match(s.html(), /<h1>Welcome to Claudestrator<\/h1>/);
  assert.match(s.html(), /class="acc-tile add alone" data-action="start-add"/);
  assert.deepEqual(s.keys(), []);
  assert.doesNotMatch(s.html(), /start-back/, 'nowhere to go back to without an account');
});

test('start: one account signed in from two folders is one tile, working under the folder in use, its other folder counted', async () => {
  const s = await startScreen([
    { dir: `${ME}/.claude`, label: 'claude', email: 'Jurek@Rollix.email', current: false, loggedIn: true },
    { dir: `${ME}/.claude-work`, label: 'work', email: 'jurek@rollix.email', current: true, loggedIn: true, plan: 'team' },
    { dir: `${ME}/.claude-b`, label: 'b', email: 'b@example.com', current: false, loggedIn: false },
  ]);
  assert.deepEqual(s.keys(), ['jurek@rollix.email', 'b@example.com']);
  assert.match(s.html(), /class="acc-tile current" data-key="jurek@rollix.email" draggable="true">\s*<button class="acc-main" data-action="start-pick" data-dir="\/Users\/me\/.claude-work"/);
  assert.match(s.html(), /Team · ~\/.claude-work \+1/);
  assert.equal((s.html().match(/acc-inuse/g) || []).length, 1, 'the tile in use, and only it, says so');
  assert.match(s.html(), /data-dir="\/Users\/me\/.claude-work"[\s\S]*?<span class="acc-inuse">In use<\/span>/);
  assert.match(s.html(), /acc-state ok">Signed in/);
  assert.match(s.html(), /acc-state warn">Signed out · sign in/);
  assert.match(s.html(), /<h1>Choose an account<\/h1>/);
  assert.match(s.html(), /<button class="btn ghost sm start-back" data-action="go-home"/, 'back to the tasks, the account as it is');
});

test('start: tiles come in the order kept for them; the ones it does not name follow as they came', async () => {
  const s = await startScreen(
    [
      { dir: `${ME}/.claude-a`, label: 'a', email: 'a@x.dev', current: false },
      { dir: `${ME}/.claude-b`, label: 'b', email: 'b@x.dev', current: false },
      { dir: `${ME}/.claude-c`, label: 'c', email: 'c@x.dev', current: false },
      { dir: `${ME}/.claude-new`, label: 'new', current: false },
    ],
    ['c@x.dev', 'a@x.dev', 'gone@x.dev']
  );
  assert.deepEqual(s.keys(), ['c@x.dev', 'a@x.dev', 'b@x.dev', `dir:${ME}/.claude-new`]);
});

test('start: a tile dropped onto another swaps places with it, and the host keeps the order', async () => {
  const accounts = ['a', 'b', 'c'].map((n) => ({ dir: `${ME}/.claude-${n}`, label: n, email: `${n}@x.dev`, current: false }));
  const s = await startScreen(accounts);
  const transfer = { setData() {}, effectAllowed: '' };
  s.fire('dragstart', { target: new Element('a@x.dev'), dataTransfer: transfer });
  s.fire('dragover', { target: new Element('c@x.dev') });
  s.fire('drop', { target: new Element('c@x.dev') });
  assert.deepEqual(s.keys(), ['c@x.dev', 'b@x.dev', 'a@x.dev']);
  assert.deepEqual(s.asked, [['setAccountOrder', { order: ['c@x.dev', 'b@x.dev', 'a@x.dev'] }]]);
});

test('start: Alt+→ swaps a tile with the next one; at the end it stays', async () => {
  const accounts = ['a', 'b'].map((n) => ({ dir: `${ME}/.claude-${n}`, label: n, email: `${n}@x.dev`, current: false }));
  const s = await startScreen(accounts);
  s.fire('keydown', { target: new Element('a@x.dev'), altKey: true, key: 'ArrowRight' });
  assert.deepEqual(s.keys(), ['b@x.dev', 'a@x.dev']);
  s.fire('keydown', { target: new Element('a@x.dev'), altKey: true, key: 'ArrowRight' });
  s.fire('keydown', { target: new Element('b@x.dev'), altKey: false, key: 'ArrowRight' });
  assert.deepEqual(s.keys(), ['b@x.dev', 'a@x.dev']);
  assert.equal(s.asked.length, 1);
});

test('start: a signed-in account is worked under at once; a signed-out one is signed in to first', async () => {
  const s = await startScreen([
    { dir: `${ME}/.claude`, label: 'claude', email: 'a@x.dev', current: true, loggedIn: true },
    { dir: `${ME}/.claude-b`, label: 'b', email: 'b@x.dev', current: false, loggedIn: false },
  ]);
  await s.view.actions['start-pick']!({ dataset: { dir: `${ME}/.claude` } });
  assert.deepEqual(s.went, [{ name: 'home' }]);
  await s.view.actions['start-pick']!({ dataset: { dir: `${ME}/.claude-b` } });
  assert.deepEqual(s.asked, [['setAccount', { dir: `${ME}/.claude` }], ['setAccount', { dir: `${ME}/.claude-b` }], ['claudeLogin', null]]);
  assert.equal(s.went.length, 1, 'it stays on Start while you sign in');
});

test('start: an alias is the tile\'s name, with the email under it', async () => {
  const s = await startScreen([{ dir: `${ME}/.claude-work`, label: 'work', email: 'jurek@rollix.email', current: true }], [], { 'jurek@rollix.email': 'Work' });
  assert.match(s.html(), /<span class="acc-avatar [^"]+" aria-hidden="true">W<\/span>\s*<span class="acc-name">Work<\/span>\s*<span class="acc-email">jurek@rollix.email<\/span>/);
});

test('start: renaming writes the alias in the tile; Enter keeps it, an empty one takes it off', async () => {
  const s = await startScreen([{ dir: `${ME}/.claude`, label: 'claude', email: 'a@x.dev', current: false }]);
  s.view.actions['start-rename']!({ dataset: { key: 'a@x.dev' } });
  assert.match(s.html(), /class="acc-tile editing" data-key="a@x.dev"/);
  assert.match(s.html(), /<input class="input sm acc-alias" data-change="start-alias" data-key="a@x.dev" value="" placeholder="a"/);
  assert.doesNotMatch(s.html(), /draggable/, 'a tile being named is not dragged');
  assert.ok(s.aliasInput.focused);
  s.view.changes['start-alias']!({ dataset: { key: 'a@x.dev' }, value: '  Personal  ' });
  assert.match(s.html(), /<span class="acc-name">Personal<\/span>/);
  assert.doesNotMatch(s.html(), /acc-alias/);
  s.view.actions['start-rename']!({ dataset: { key: 'a@x.dev' } });
  assert.match(s.html(), /value="Personal"/);
  s.view.changes['start-alias']!({ dataset: { key: 'a@x.dev' }, value: '' });
  assert.match(s.html(), /<span class="acc-name">a@x.dev<\/span>/);
  assert.deepEqual(s.asked, [['setAccountAlias', { key: 'a@x.dev', alias: 'Personal' }], ['setAccountAlias', { key: 'a@x.dev', alias: '' }]]);
});

test('start: Esc leaves the alias as it was', async () => {
  const s = await startScreen([{ dir: `${ME}/.claude`, label: 'claude', email: 'a@x.dev', current: false }], [], { 'a@x.dev': 'Old' });
  s.view.actions['start-rename']!({ dataset: { key: 'a@x.dev' } });
  s.fire('keydown', { target: new Element('a@x.dev'), key: 'Escape' });
  assert.match(s.html(), /<span class="acc-name">Old<\/span>/);
  assert.deepEqual(s.asked, []);
});

test('start: removing signs out of every folder of the account; its tile goes once the host did it', async () => {
  const accounts = [
    { dir: `${ME}/.claude`, label: 'claude', email: 'jurek@rollix.email', current: false, loggedIn: true },
    { dir: `${ME}/.claude-work`, label: 'work', email: 'jurek@rollix.email', current: true, loggedIn: true },
    { dir: `${ME}/.claude-b`, label: 'b', email: 'b@x.dev', current: false, loggedIn: true },
  ];
  const kept = await startScreen(accounts, [], {}, { removeAccount: { removed: false } });
  await kept.view.actions['start-remove']!({ dataset: { key: 'jurek@rollix.email' } });
  assert.deepEqual(kept.asked, [['removeAccount', { dirs: [`${ME}/.claude`, `${ME}/.claude-work`] }]]);
  assert.deepEqual(kept.keys(), ['jurek@rollix.email', 'b@x.dev'], 'you said no: nothing changes');

  const s = await startScreen(accounts, [], {}, { removeAccount: { removed: true } });
  const before = s.loads();
  s.hostHas({ accounts: [accounts[2]!] });
  await s.view.actions['start-remove']!({ dataset: { key: 'jurek@rollix.email' } });
  assert.equal(s.loads(), before + 1);
  assert.deepEqual(s.keys(), ['b@x.dev']);
});
