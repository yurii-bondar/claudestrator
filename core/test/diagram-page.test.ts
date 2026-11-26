// The scenario diagram (page/diagram*.ts) opened to look at, run as the page runs it: the compiled scripts in one
// context of their own, with the shell (window.CS) reduced to what records what the view draws and asks the host.
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

interface Step {
  name: string;
  [k: string]: unknown;
}
interface Draft {
  id: string | null;
  label: string;
  steps: Step[];
  dirty: boolean;
  readonly?: boolean;
}
interface DiagramView {
  enter(route: unknown): Promise<void>;
  actions: Record<string, (el: unknown) => unknown>;
  change(fn: (d: Draft) => void): void;
  save(): Promise<boolean>;
  draft(): Draft;
}

const AGENTS = [
  { name: 'planner', output: 'plan', enabled: true, color: 'blue', model: 'opus', effort: 'high' },
  { name: 'developer', output: 'code', enabled: true, color: 'green', model: 'sonnet', effort: 'medium' },
  { name: 'reviewer', output: 'verdict', enabled: true, color: 'purple', model: 'opus', effort: 'high' },
  { name: 'verifier', output: 'readiness', enabled: true, color: 'cyan', model: 'opus', effort: 'high' },
];

function diagramPage() {
  const html: Record<string, string> = {};
  const saved: unknown[] = [];
  const classes = new Set<string>();
  const S = { ui: {} as { diagram?: Draft | null; diagramEdit?: Draft | null; dgSideCollapsed?: boolean }, route: { name: 'scenario-diagram' } as Record<string, unknown>, draft: {} };
  const views: Record<string, unknown> = { home: { scenarioAgents: () => [] } };
  const config = {
    ok: true,
    agents: AGENTS,
    config: {
      pipeline: ['planner', 'developer', 'reviewer'],
      scenarios: { readiness: ['verifier'] },
      custom: { mine: { label: 'Mine', description: 'My own', agents: [{ name: 'developer' }, { name: 'reviewer', approve: {} }], intake: {} } },
    },
  };
  const el = () => ({ innerHTML: '', style: {} as Record<string, string>, classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)), add() {}, remove() {}, contains: () => false }, setAttribute() {}, focus() {}, select() {}, scrollIntoView() {} });
  const known: Record<string, unknown> = {
    S,
    views,
    OUTPUT_INFO: {},
    EFFORT_LABEL: {},
    esc: (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    icon: (name: string) => `<i data-icon="${name}"></i>`,
    plural: (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`,
    agentColor: (c: string) => `c-${c}`,
    modelChoices: () => [],
    scInfo: (id: string) => ({ deliver: { label: 'Deliver', hint: 'Plan, code, review', custom: false }, readiness: { label: 'Readiness', hint: 'Is it done?', custom: false }, mine: { label: 'Mine', hint: 'My own', custom: true } })[id] ?? { label: id, hint: '', custom: false },
    patch: (region: string, h: string) => ((html[region] = h), true),
    call: async (method: string) => (method === 'config' ? config : method === 'previewScenario' ? Promise.reject(new Error('none')) : {}),
    attempt: async (method: string, params: unknown) => void saved.push([method, params]),
    loadOverview: async () => {},
    persist: () => {},
    debounce: (_k: string, fn: () => void) => fn(),
    toast: () => {},
    go: async () => {},
    $: () => el(),
    $$: () => [],
  };
  const CS = new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : () => '') });
  const listeners = { addEventListener() {} };
  const ctx = vm.createContext({ window: { CS }, document: listeners, Element: class {}, HTMLElement: class {}, HTMLInputElement: class {} });
  for (const f of ['diagram-model.js', 'diagram-canvas.js', 'diagram-side.js', 'diagram.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'page', f), 'utf8'), ctx, { filename: f });
  const view = views['scenario-diagram'] as DiagramView;
  const open = async (route: Record<string, unknown>) => {
    S.route = { name: 'scenario-diagram', ...route };
    await view.enter(S.route);
  };
  return { view, open, html, S, saved, classes };
}

test('diagram page: a built-in scenario is drawn to look at, by its agents, and nothing on it changes or saves', async () => {
  const p = diagramPage();
  await p.open({ scenario: 'deliver', view: true });
  const d = p.view.draft();
  assert.deepEqual([d.id, d.readonly, d.steps.map((s) => s.name)], ['deliver', true, ['planner', 'developer', 'reviewer']], "Deliver's steps are the pipeline");
  assert.ok(p.classes.has('dg-view'), 'the page hides what adds and moves steps');
  assert.match(p.html['dg-head']!, /view only/);
  assert.match(p.html['dg-head']!, /data-action="diagram-copy"[^>]*>.*Edit a copy/, 'a built-in one is edited as a copy');
  assert.doesNotMatch(p.html['dg-head']!, /dg-save/);
  assert.match(p.html['dg-side']!, /<\/div><fieldset class="dg-view-side" disabled>/, 'the right column only shows');
  assert.match(p.html['dg-flow']!, /planner[\s\S]*developer[\s\S]*reviewer/);

  p.view.change((x) => void x.steps.pop());
  assert.equal(p.view.draft().steps.length, 3, 'a change does nothing');
  assert.equal(p.view.draft().dirty, false);
  assert.equal(await p.view.save(), false);
  assert.deepEqual(p.saved, [], 'and nothing is written');

  await p.open({ scenario: 'readiness', view: true });
  assert.deepEqual(p.view.draft().steps.map((s) => s.name), ['verifier'], 'a built-in report by its scenario list');
});

test("diagram page: your own scenario is drawn as saved; looking at it keeps a diagram's unsaved changes for when it is edited again", async () => {
  const p = diagramPage();
  await p.open({ scenario: 'mine' });
  assert.equal(p.view.draft().readonly, undefined, 'opened to edit');
  p.view.change((x) => void x.steps.push({ name: 'planner' }));
  assert.equal(p.view.draft().dirty, true);

  await p.open({ scenario: 'mine', view: true });
  const seen = p.view.draft();
  assert.deepEqual([seen.readonly, seen.dirty, seen.steps.map((s) => s.name)], [true, false, ['developer', 'reviewer']], 'what config.yaml has, not the unsaved draft');
  assert.match(p.html['dg-head']!, /data-action="nav-diagram" data-id="mine"/, 'Edit as diagram opens the same one');
  assert.equal(p.S.ui.diagramEdit && p.S.ui.diagramEdit.steps.length, 3, 'the unsaved changes are put aside');

  await p.open({ scenario: 'mine' });
  assert.deepEqual([p.view.draft().readonly, p.view.draft().dirty, p.view.draft().steps.map((s) => s.name)], [undefined, true, ['developer', 'reviewer', 'planner']], 'and come back when it is edited');
  assert.equal(p.S.ui.diagramEdit, null);
  assert.ok(!p.classes.has('dg-view'));
});

test('diagram page: the side panel hides with its own button into a strip at the right edge, stays hidden for the next diagram, and comes back for a step picked or from the strip', async () => {
  const p = diagramPage();
  await p.open({ scenario: 'deliver', view: true });
  assert.ok(!p.classes.has('side-collapsed'));
  assert.match(p.html['dg-side']!, /^<div class="dg-side-bar"><button class="icon-btn" data-action="dg-side-toggle"[^>]*aria-label="Hide the side panel"/, 'its button is on the panel, out of the view-only fieldset');
  assert.doesNotMatch(p.html['dg-side']!, /<fieldset[^>]*>.*dg-side-toggle/s);
  p.view.actions['dg-side-toggle']!({ dataset: {} });
  assert.equal(p.S.ui.dgSideCollapsed, true);
  assert.ok(p.classes.has('side-collapsed'), 'the canvas takes the width');
  assert.match(p.html['dg-side']!, /^<button class="dg-side-strip" data-action="dg-side-toggle"[^>]*aria-label="Show the side panel"/, 'a strip brings it back');
  assert.doesNotMatch(p.html['dg-side']!, /Route check|fieldset/);

  await p.open({ scenario: 'mine', view: true });
  assert.ok(p.classes.has('side-collapsed'), 'the next diagram opens with it hidden too');
  p.view.actions['dg-select']!({ dataset: { i: '0' } });
  assert.equal(p.S.ui.dgSideCollapsed, false, 'a step picked brings it back');
  assert.ok(!p.classes.has('side-collapsed'));
  assert.match(p.html['dg-side']!, /dg-side-bar/);

  p.view.actions['dg-side-toggle']!({ dataset: {} });
  p.view.actions['dg-side-toggle']!({ dataset: {} });
  assert.equal(p.S.ui.dgSideCollapsed, false, 'and so does the strip');
  assert.match(p.html['dg-side']!, /dg-side-bar/);
});
