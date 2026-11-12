// The dashboard in a real browser (`npm run test:ui`; not part of `npm test`, it needs Chrome): the preview harness,
// with the real Orchestrator, panel handlers and engine, in headless Chrome over the DevTools protocol. A throwaway
// HOME, so none of your logins, MCP servers or tokens reach it; the tools' health is set by the test, in the answers
// the page gets, so every state of gh, glab and the Linear MCP server can be drawn on one machine.
//   CHROME=/path/to/chrome when Chrome is not where it is usually installed.
import test, { after, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../../scripts/design-sync/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4790;
const URL_ = `http://127.0.0.1:${PORT}/`;

let server;
let b;
let ws;

/** The preview harness, configured, with nothing of yours: its workspace folder once it listens. */
function startPreview() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cs-ui-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, PREVIEW_SETUP: '1', PREVIEW_DELAY: '50', PREVIEW_PORT: String(PORT) };
  for (const k of ['CLAUDE_CONFIG_DIR', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN', 'ATLASSIAN_API_TOKEN']) delete env[k];
  server = spawn(process.execPath, [path.join(ROOT, 'dist', 'vscode', 'test', 'harness', 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let out = '';
    server.on('exit', (code) => reject(new Error(`the preview exited (${code}): ${out}`)));
    server.stdout.on('data', (d) => {
      out += String(d);
      const m = out.match(/workspace: (\S+)/);
      if (m) resolve(m[1]);
    });
  });
}

const until = async (expr, what, ms = 20000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await b.eval(expr)) return;
    await b.sleep(100);
  }
  throw new Error(`timed out waiting for ${what}: ${(await b.eval(`document.body.innerText.slice(0, 600)`)) || ''}`);
};

/** The tools' health as the page will be told it, merged into every answer that carries it. */
const HEALTH = `(() => {
  window.__health = {};
  window.__overview = {};
  window.addEventListener('message', (e) => {
    const m = e.data, d = m && m.data;
    if (!(m && m.type === 'res' && d && typeof d === 'object')) return;
    if (d.claude && d.git && d.gh) Object.assign(d, window.__health);
    if (d.health && !d.health.checking) Object.assign(d.health, window.__health);
    if ('hasConfig' in d) Object.assign(d, window.__overview);
  }, true);
  return true;
})()`;

/** The text of what `expr` finds, its runs of white space as one space (block elements break the lines). */
const textOf = (expr) => b.eval(`((${expr}) || {}).innerText?.replace(/\\s+/g, ' ') || ''`);

const cli = (ok, installed = ok, account = 'ann') => ({ ok, installed, version: installed ? '1.0' : undefined, account: ok ? account : undefined, error: ok ? undefined : installed ? 'not logged in' : 'not installed' });
const tools = (over = {}) => ({ claude: { ok: true, version: '2.1.302', path: '/bin/claude', error: undefined }, git: { ok: true, version: '2.47' }, gh: cli(true), glab: cli(false, false), atlassian: false, atlassianMcp: null, linearMcp: null, ...over });

/** Sets what the page is told about the tools, has it read the overview again, and opens `route` to draw it. */
async function setHealth(over, route = 'home') {
  await b.eval(`(async () => { window.__health = ${JSON.stringify(tools(over))}; await window.CS.loadOverview(); window.CS.go({ name: 'settings' }); window.CS.go({ name: ${JSON.stringify(route)} }); return true; })()`);
  await b.sleep(300);
}

/** What the composer says about `text`, once it has said something with `marker` in it. */
async function detect(text, marker) {
  await b.eval(`(() => { const S = window.CS.S; S.draft.text = ${JSON.stringify(text)}; S.draft.key = ''; window.CS.views.home.preview(); return true; })()`);
  const region = `document.querySelector('[data-region="detect"]')`;
  await until(`(${region} && ${region}.innerText.replace(/\\s+/g, ' ').includes(${JSON.stringify(marker)}))`, `"${marker}" for ${text}`);
  await b.sleep(100);
  return textOf(region);
}

before(async () => {
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });
  ws = await startPreview();
  // Origins on GitHub and GitLab: the composer finds the forge of an issue reference by them.
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/api.git'], { cwd: path.join(ws, 'api') });
  execFileSync('git', ['remote', 'add', 'origin', 'git@gitlab.com:acme/web.git'], { cwd: path.join(ws, 'web') });
  b = await launch({ port: 9340, profile: mkdtempSync(path.join(os.tmpdir(), 'cs-ui-chrome-')), width: 1280, height: 900 });
  await b.goto(URL_);
  await b.eval('sessionStorage.clear(); true');
  await b.goto(URL_);
  await b.eval(HEALTH);
  await until('!!(window.CS && window.CS.S.overview)', 'the dashboard');
  await setHealth({});
  await b.eval(`window.CS.go({ name: 'home' }); true`);
  await until(`!!document.querySelector('[data-region="detect"]')`, 'the composer');
});

after(() => {
  if (b) b.close();
  if (server) server.kill();
});

test('composer: a GitHub issue is named with its project and task id, and a gh that is not ready says so', async () => {
  const ready = await detect('acme/api#12', 'GitHub issue');
  assert.match(ready, /GitHub issue acme\/api#12/);
  assert.match(ready, /api-12/);
  assert.doesNotMatch(ready, /GitHub CLI is not ready/);

  await setHealth({ gh: cli(false, true) });
  const notReady = await detect('acme/api#12', 'GitHub CLI is not ready');
  assert.match(notReady, /GitHub CLI is not ready \(not logged in\): run gh auth login/);
});

test('composer: a GitLab issue link, and a glab that is not there', async () => {
  await setHealth({ glab: cli(false, false) });
  const text = await detect('https://gitlab.com/acme/web/-/issues/3', 'GitLab issue');
  assert.match(text, /GitLab issue acme\/web#3/);
  assert.match(text, /web-3/);
  assert.match(text, /GitLab CLI is not ready \(not installed\): run glab auth login/);
});

test('composer: a Linear issue link, with and without a Linear MCP server', async () => {
  await setHealth({ linearMcp: null });
  const without = await detect('https://linear.app/acme/issue/ENG-12/dark-mode', 'Linear issue');
  assert.match(without, /Linear issue ENG-12/);
  assert.match(without, /Linear is not connected: add its MCP server \( ?claude mcp add --transport http linear https:\/\/mcp\.linear\.app\/mcp ?\) and sign in/);
  assert.doesNotMatch(without, /Jira\/Confluence is not connected/, 'not a Jira ticket');

  await setHealth({ linearMcp: 'linear' });
  const connected = await detect('https://linear.app/acme/issue/ENG-12/dark-mode', 'ENG-12');
  await until(`!document.querySelector('[data-region="detect"]').innerText.replace(/\\s+/g, ' ').includes('Linear is not connected')`, 'the warning gone');
  assert.match(connected, /Linear issue ENG-12/);
});

test('composer: #12 with repos on two forges asks which project; a Jira key still asks for Jira', async () => {
  const ambiguous = await detect('#12', 'names no one project');
  assert.match(ambiguous, /#12 names no one project: the repos are in acme\/api \(github\.com\), acme\/web \(gitlab\.com\)/);
  const jira = await detect('PROJ-7', 'Jira issue');
  assert.match(jira, /Jira issue PROJ-7/);
  assert.match(jira, /Jira\/Confluence is not connected/);
  assert.doesNotMatch(jira, /GitHub CLI|GitLab CLI|Linear is not connected/);
});

test('composer: a pull request link picks PR review, says what it will do, and what is missing to read it', async () => {
  await setHealth({ gh: cli(true), bitbucket: false });
  const pr = await detect('https://github.com/acme/api/pull/12', 'Pull request');
  assert.match(pr, /Pull request acme\/api#12 → api-pr-12/);
  assert.match(pr, /reviewer → you decide → review posted to the PR/);
  assert.doesNotMatch(pr, /draft PRs|commit/, 'it changes nothing in the repo');
  assert.equal(await b.eval(`window.CS.S.draft.scenario`), 'auto', 'picked by the link, not by you');
  assert.equal(await b.eval(`window.CS.views.home.detected`), 'pr-review');

  await setHealth({ gh: cli(false, true) });
  assert.match(await detect('https://github.com/acme/api/pull/12', 'GitHub CLI is not ready'), /GitHub CLI is not ready \(not logged in\): run gh auth login/);

  const mr = await detect('https://gitlab.com/acme/web/-/merge_requests/7', 'Merge request');
  assert.match(mr, /Merge request acme\/web!7 → web-mr-7/);
  const bb = await detect('https://bitbucket.org/acme/shop/pull-requests/3', 'Bitbucket is not connected');
  assert.match(bb, /Pull request acme\/shop#3 → shop-pr-3/);
  assert.match(bb, /no repo of this workspace has acme\/shop on bitbucket\.org as its origin/);
  assert.match(bb, /Bitbucket is not connected: add its API token/);
});

test("tools: GitLab's CLI shows once installed; with it ready, a missing gh is not a problem", async () => {
  // The Tasks page shows the whole line only when something is wrong: Claude Code here.
  const health = `document.querySelector('[data-region="health"]')`;
  await setHealth({ claude: { ok: false, error: 'not found on PATH' }, glab: cli(true, true, 'gl-ann') });
  await until(`(${health} || {}).innerText?.includes('GitLab CLI')`, 'GitLab CLI in the health line');
  assert.match(await textOf(health), /GitLab CLI gl-ann/);

  await setHealth({ claude: { ok: false, error: 'not found on PATH' }, glab: cli(false, false) });
  assert.match(await textOf(health), /Claude Code not found on PATH/);
  assert.doesNotMatch(await textOf(health), /GitLab CLI/, 'not when it is not installed');

  const rail = `document.querySelector('[data-region="rail-foot"]')`;
  await setHealth({ gh: cli(false), glab: cli(false, false) });
  assert.match(await textOf(rail), /GitHub CLI is not ready/);
  await setHealth({ gh: cli(false, false), glab: cli(true) });
  assert.doesNotMatch(await textOf(rail), /GitHub CLI is not ready/, 'glab is ready: nothing is wrong');
});

test('setup: the tools list GitLab CLI as optional, signed in or how to sign in', async () => {
  // The tools are on the setup page of a workspace with no config yet.
  await b.eval(`window.__overview = { hasConfig: false }; true`);
  try {
    await setHealth({ glab: cli(true, true, 'gl-ann') }, 'setup');
    await until(`document.body.innerText.includes('GitLab CLI')`, 'the setup tools');
    assert.match(await textOf('document.body'), /GitLab CLI logged in as gl-ann/);

    await setHealth({ glab: cli(false, false) }, 'setup');
    await until(`document.body.innerText.includes('needed only for repos and issues on GitLab')`, 'how to get glab');
    assert.match(await textOf('document.body'), /GitLab CLI not installed Optional: needed only for repos and issues on GitLab\. Run glab auth login\./);
    assert.match(await textOf('document.body'), /GitHub CLI logged in as ann/);
  } finally {
    await b.eval(`window.__overview = {}; true`);
  }
});

test('integrations: Bitbucket is set up with an email and a token, which the page never shows, and forgotten again', async () => {
  const card = `(document.querySelector('#sec-bitbucket') || {}).innerText?.replace(/\\s+/g, ' ') || ''`;
  await b.eval(`window.CS.go({ name: 'mcp' }); true`);
  await until(`${card}.includes('Bitbucket Cloud')`, 'the Bitbucket card');
  assert.match(await b.eval(card), /Opening pull requests not set up: needed only for repos on bitbucket\.org/);
  assert.equal(await b.eval(`document.querySelector('[data-action="bb-test"]').disabled`), true, 'nothing to test yet');

  await b.eval(`(() => { document.querySelector('#bb-email').value = 'ci@acme.com'; document.querySelector('#bb-token').value = 'bb-ui-secret-123'; document.querySelector('[data-action="bb-save"]').click(); return true; })()`);
  await until(`!!document.querySelector('[data-action="bb-forget"]')`, 'the token saved');
  assert.match(await b.eval(card), /API token saved/);
  assert.match(await b.eval(card), /Opening pull requests with the API token below, for repos whose origin is on bitbucket\.org/);
  assert.equal(await b.eval(`document.querySelector('#bb-email').value`), 'ci@acme.com');
  assert.equal(await b.eval(`document.querySelector('[data-action="bb-test"]').disabled`), false);
  assert.equal(await b.eval(`document.documentElement.outerHTML.includes('bb-ui-secret-123')`), false, 'the token is not in the page');
  const settings = await b.eval(`window.CS.call('settings')`);
  assert.deepEqual(settings.bitbucket, { email: 'ci@acme.com', hasToken: true, fromEnv: false, connected: true });

  await b.eval(`document.querySelector('[data-action="bb-forget"]').click(); true`);
  await until(`!document.querySelector('[data-action="bb-forget"]')`, 'the token forgotten');
  assert.match(await b.eval(card), /Opening pull requests not set up/);
  assert.equal(await b.eval(`document.querySelector('[data-action="bb-test"]').disabled`), true);
});

test('task list: an issue task gets a chip with its reference that opens the issue', async () => {
  const chip = await b.eval(`window.CS.sourceChip({ kind: 'github', label: 'acme/api#12', url: 'https://github.com/acme/api/issues/12' })`);
  assert.match(chip, /^<a class="chip link-chip" data-action="open-url" data-url="https:\/\/github\.com\/acme\/api\/issues\/12"/);
  assert.ok(chip.includes(await b.eval(`window.CS.icon('issue')`)), 'the issue icon');
  assert.match(chip, /acme\/api#12<\/a>$/);
  for (const kind of ['gitlab', 'linear']) assert.ok((await b.eval(`window.CS.sourceChip({ kind: '${kind}', label: 'x' })`)).includes(await b.eval(`window.CS.icon('issue')`)), kind);
  assert.ok((await b.eval(`window.CS.sourceChip({ kind: 'jira', label: 'CP-1' })`)).includes(await b.eval(`window.CS.icon('jira')`)), 'Jira keeps its own');
});

/**
 * A button pressed while its region is drawn anew (an agent's push lands, a task card moves): with the mouse, through
 * Chrome's input, as a person clicks. Reports whether the page heard the click, and what the region shows after.
 */
async function clickWhileRedrawn() {
  await b.eval(`(() => {
    window.__clicks = 0;
    window.CS.actions['ui-probe'] = () => void window.__clicks++;
    document.getElementById('ui-probe-host')?.remove();
    document.body.insertAdjacentHTML('beforeend', '<div id="ui-probe-host" data-region="ui-probe" style="position:fixed;top:0;left:0;z-index:9999"></div>');
    window.CS.patch('ui-probe', '<button data-action="ui-probe" style="width:120px;height:40px">one</button>');
    return true;
  })()`);
  const at = { x: 60, y: 20, button: 'left', clickCount: 1 };
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
  await b.eval(`window.CS.patch('ui-probe', '<button data-action="ui-probe" style="width:120px;height:40px">two</button>'); true`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
  await b.sleep(50);
  const result = { clicks: await b.eval('window.__clicks'), text: await textOf(`document.querySelector('[data-region="ui-probe"]')`) };
  await b.eval(`document.getElementById('ui-probe-host').remove(); delete window.CS.actions['ui-probe']; true`);
  return result;
}

test('clicks: a button whose region is drawn anew between the press and the release still gets the click', async () => {
  const r = await clickWhileRedrawn();
  assert.equal(r.clicks, 1, 'the click went through');
  assert.equal(r.text, 'two', 'and the region shows what it was drawn with, once the click is done');
});

/** A task as the overview lists it, running or finished. */
const card = (taskId, title, running) => ({
  taskId, title, source: null, scenario: 'deliver', checkpoint: null, live: null, error: null, stopReason: undefined, round: 1, maxRounds: 2,
  status: running ? { key: 'running', label: 'Running', tone: 'accent', group: 'running', resumable: false } : { key: 'done', label: 'Done', tone: 'ok', group: 'done', resumable: false },
  phase: running ? 'agents' : 'done', outcome: undefined, prs: {}, branch: null, repos: [], cost: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: { done: 0, total: 1 }, mini: [],
});
/** The tasks with a tab, in the order the strip shows them. */
const tabs = () => b.eval(`[...document.querySelectorAll('.task-tabs .task-tab')].map((t) => t.dataset.id)`);

test('task tabs: none by default; "Open in Tab" adds one, a drag reorders them, × closes one', async () => {
  const tasks = [card('t-a', 'Alpha', true), card('t-b', 'Beta', false), card('t-c', 'Gamma', true)];
  await b.eval(`(async () => { window.__overview = { tasks: ${JSON.stringify(tasks)}, sections: [] }; window.CS.S.ui.taskTabs = []; await window.CS.loadOverview(); await window.CS.go({ name: 'settings' }); return true; })()`);
  assert.equal(await b.eval(`!!document.querySelector('.task-tabs')`), false, 'running tasks open no tab by themselves');

  // As the host sends it for the menu's Open in Tab.
  for (const id of ['t-a', 't-b', 't-c']) {
    await b.eval(`window.postMessage({ type: 'navigate', route: { name: 'task', taskId: '${id}', tab: true } }, '*'); true`);
    await until(`document.querySelectorAll('.task-tabs .task-tab').length && [...document.querySelectorAll('.task-tab')].some((t) => t.dataset.id === '${id}')`, `the tab of ${id}`);
  }
  assert.deepEqual(await tabs(), ['t-a', 't-b', 't-c']);
  assert.equal(await b.eval(`window.CS.S.route.tab`), undefined, 'the route keeps no tab flag');
  assert.match(await textOf(`document.querySelector('.task-tab[data-id="t-b"]')`), /Beta/);

  // Gamma dropped on the left half of Alpha goes first.
  await b.eval(`(() => {
    const at = (id) => document.querySelector('.task-tab[data-id="' + id + '"]');
    const dt = new DataTransfer();
    const r = at('t-a').getBoundingClientRect();
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 2, clientY: r.top + 2 }));
    fire(at('t-c'), 'dragstart');
    fire(at('t-a'), 'dragover');
    fire(at('t-a'), 'drop');
    fire(at('t-c'), 'dragend');
    return true;
  })()`);
  assert.deepEqual(await tabs(), ['t-c', 't-a', 't-b']);

  await b.eval(`document.querySelector('.task-tab[data-id="t-a"] .tab-x').click(); true`);
  assert.deepEqual(await tabs(), ['t-c', 't-b']);
  assert.deepEqual(await b.eval(`window.CS.S.ui.taskTabs`), ['t-c', 't-b'], 'kept for the next time the page loads');

  // A task deleted since loses its tab.
  await b.eval(`(async () => { window.__overview = { tasks: ${JSON.stringify([tasks[1]])}, sections: [] }; await window.CS.loadOverview(); return true; })()`);
  assert.deepEqual(await tabs(), ['t-b']);

  await b.eval(`(async () => { window.__overview = {}; window.CS.S.ui.taskTabs = []; await window.CS.loadOverview(); return true; })()`);
});

test('task tabs: ⌘-click on a task of the rail opens it in a tab; a plain click opens it alone', async () => {
  const tasks = [card('t-a', 'Alpha', true), card('t-b', 'Beta', false)];
  const sections = [{ key: 'ungrouped', kind: 'ungrouped', label: 'Ungrouped', taskIds: ['t-a', 't-b'] }];
  await b.eval(`(async () => { window.__overview = { tasks: ${JSON.stringify(tasks)}, sections: ${JSON.stringify(sections)} }; window.CS.S.ui.taskTabs = []; window.CS.S.ui.tasksOpen = true; window.CS.S.ui.treeOpen = { ungrouped: true }; window.CS.S.ui.treeDone = { ungrouped: true }; await window.CS.loadOverview(); await window.CS.go({ name: 'settings' }); return true; })()`);
  /** Clicks a task of the rail with the mouse; `modifiers` 4 is ⌘ (Meta). */
  const click = async (id, modifiers = 0) => {
    const at = await b.eval(`(() => { const r = document.querySelector('.tree-task[data-id="${id}"]').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
    const ev = { x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers };
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...ev });
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...ev });
    await b.sleep(150);
  };
  await click('t-a');
  assert.deepEqual(await tabs(), [], 'a plain click opens no tab');
  await until(`!!document.querySelector('.tree-task[data-id="t-b"]')`, 'the rail again');
  await click('t-b', 4);
  await until(`document.querySelectorAll('.task-tabs .task-tab').length === 1`, 'the tab');
  assert.deepEqual(await tabs(), ['t-b']);

  await b.eval(`(async () => { window.__overview = {}; window.CS.S.ui.taskTabs = []; await window.CS.loadOverview(); return true; })()`);
});

test('integrations: a hidden MCP server leaves the list for a folded one, and Show brings it back', async () => {
  const server = (name, state) => ({ name, scope: 'user', state, transport: 'http', target: `https://${name}.example/mcp`, canLogin: true, login: null });
  const servers = [server('asana', 'needs_auth'), server('jenkins', 'failed'), server('atlassian', 'connected')];
  // The harness has no MCP servers of its own: the page is told of these, and what you hid comes from the host.
  await b.eval(`(() => {
    window.addEventListener('message', (e) => { const d = e.data && e.data.data; if (e.data && e.data.type === 'res' && d && Array.isArray(d.servers) && 'hidden' in d) d.servers = ${JSON.stringify(servers)}; }, true);
    window.CS.S.ui.mcpHiddenOpen = false;
    window.CS.go({ name: 'mcp' });
    return true;
  })()`);
  const shown = () => b.eval(`[...document.querySelectorAll('.mcp-list:not(.mcp-hidden) .mcp-name')].map((n) => n.textContent)`);
  await until(`document.querySelectorAll('.mcp-row').length === 3`, 'the servers');
  assert.match(await textOf(`document.querySelector('.mcp-legend')`), /error or needs sign-in · 2/);

  await b.eval(`document.querySelector('[data-action="mcp-hide"][data-name="jenkins"]').click(); true`);
  await until(`!!document.querySelector('.mcp-hidden-fold')`, 'the hidden servers');
  assert.deepEqual(await shown(), ['asana', 'atlassian']);
  assert.match(await textOf(`document.querySelector('.mcp-legend')`), /error or needs sign-in · 1/, 'its error counts no more');
  assert.match(await textOf(`document.querySelector('.mcp-hidden-fold')`), /Hidden · 1/);
  assert.equal(await b.eval(`!!document.querySelector('.mcp-hidden')`), false, 'folded');

  await b.eval(`document.querySelector('.mcp-hidden-fold').click(); true`);
  await b.eval(`document.querySelector('.mcp-hidden [data-action="mcp-hide"][data-name="jenkins"]').click(); true`);
  await until(`!document.querySelector('.mcp-hidden-fold')`, 'jenkins back');
  assert.deepEqual(await shown(), ['asana', 'jenkins', 'atlassian']);
});

test('composer: Stay awake names the tool of each system and whether this one has it, offers to install it, and takes hours', async () => {
  const menu = `document.querySelector('[data-region="awake"]')`;
  // Linux without systemd-inhibit: the menu says so and offers the command that installs it.
  await b.eval(`(async () => { window.__overview = { awake: { name: 'systemd-inhibit', path: null, install: 'sudo apt-get install -y systemd', about: 'systemd-inhibit (part of systemd) is not installed' } }; window.CS.S.draft.awake = null; await window.CS.loadOverview(); await window.CS.go({ name: 'settings' }); await window.CS.go({ name: 'home' }); return true; })()`);
  await until(`!!document.querySelector('.awake-btn')`, 'the Stay awake button');
  const tip = await b.eval(`document.querySelector('.awake-btn').title`);
  assert.match(tip, /macOS: caffeinate \(built in\) · Linux: systemd-inhibit \(part of systemd\)/);
  assert.match(tip, /Here: systemd-inhibit \(part of systemd\) is not installed/);
  assert.match(await textOf(`${menu}.querySelector('.awake-tool')`), /not installed\s*sudo apt-get install -y systemd\s*Install…\s*Check again/);

  await b.eval(`document.querySelector('.awake-btn').click(); document.querySelector('[data-action="draft-awake"][data-minutes="120"]').click(); true`);
  assert.deepEqual(await b.eval(`window.CS.S.draft.awake`), { minutes: 120 });
  assert.match(await textOf(`document.querySelector('.awake-btn')`), /Awake · 2 h/);
  assert.equal(await b.eval(`document.querySelector('.awake-btn').classList.contains('bad')`), true, 'chosen without the tool: a warning');

  await b.eval(`(() => { const i = document.querySelector('[data-change="draft-awake-hours"]'); i.value = '1.5'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  assert.deepEqual(await b.eval(`window.CS.S.draft.awake`), { minutes: 90 });
  await b.eval(`document.querySelector('[data-action="draft-awake"][data-minutes="run"]').click(); true`);
  assert.match(await textOf(`document.querySelector('.awake-btn')`), /Awake while it runs/);
  await b.eval(`document.querySelector('[data-action="draft-awake"][data-minutes="off"]').click(); true`);
  assert.equal(await b.eval(`window.CS.S.draft.awake`), null);

  // This machine's own tool, as the host found it.
  await b.eval(`(async () => { window.__overview = {}; await window.CS.loadOverview(); window.CS.views.home.renderAwake(); return true; })()`);
  if (process.platform === 'darwin') assert.match(await textOf(`${menu}.querySelector('.awake-tool')`), /caffeinate, built into macOS: installed/);
});

test('rail: the workspace is named with a folder icon, or a repo icon when it is a git repository itself', async () => {
  const kind = () => b.eval(`(() => { const i = document.querySelector('[data-region="workspace"] .ws-icon'); return i && (i.classList.contains('ws-repo') ? 'repo' : 'folder'); })()`);
  await b.eval(`(async () => { await window.CS.loadOverview(); return true; })()`);
  assert.equal(await kind(), 'folder', 'a folder of repos');
  assert.equal(await textOf(`document.querySelector('[data-region="workspace"] .brand-name')`), path.basename(ws));
  execFileSync('git', ['init', '-q'], { cwd: ws });
  try {
    await b.eval(`(async () => { await window.CS.loadOverview(); return true; })()`);
    assert.equal(await kind(), 'repo');
    assert.match(await b.eval(`document.querySelector('[data-region="workspace"] .brand-name').title`), /\(a git repository\)/);
  } finally {
    rmSync(path.join(ws, '.git'), { recursive: true, force: true });
  }
});
