// The task screen of a task from an issue (the branch its plan will make, as the engine names it), and of a reviewed
// pull request (what would be posted, with each finding to untick).
import test from 'node:test';
import * as assert from 'node:assert/strict';

import { sent, taskScreen } from './helpers/task-page';

/** The plan waiting for approval, of a task from `source`. */
const planScreen = (taskId: string, source: Record<string, unknown> | null) => ({
  taskId,
  source,
  status: { key: 'waiting', tone: 'warn', label: 'Approve the plan', resumable: false },
  checkpointFull: { id: 'approve-plan' as const, options: ['approve', 'change', 'stop'], at: 'now' },
  checkpointContext: { format: 'markdown' as const, text: '## Summary\n\nDo it.' },
  plan: { type: 'feat', slug: 'validate-signup', title: 'validate signup', repos: [{ name: 'api', mode: 'full' }], openQuestions: [] },
});

/** The branch chip of the plan's checkpoint. */
const branchChip = (html: string): string => {
  const m = html.match(/<span class="chip mono"><i data-icon="branch"><\/i>([^<]*)<\/span>/);
  assert.ok(m, 'a branch chip');
  return m[1]!;
};

test('task page: a task from an issue shows the branch with its id, as the engine makes it', async () => {
  const cases: [string, Record<string, unknown> | null, string][] = [
    ['api-12', { kind: 'github', label: 'acme/api#12', url: 'https://github.com/acme/api/issues/12' }, 'feat/api-12-validate-signup'],
    ['web-3', { kind: 'gitlab', label: 'acme/web#3', url: 'https://gitlab.com/acme/web/-/issues/3' }, 'feat/web-3-validate-signup'],
    ['ENG-7', { kind: 'linear', label: 'ENG-7', url: 'https://linear.app/acme/issue/ENG-7' }, 'feat/ENG-7-validate-signup'],
    ['CP-1', { kind: 'jira', label: 'CP-1' }, 'feat/CP-1-validate-signup'],
    ['DOC-42', { kind: 'confluence', label: 'Confluence page' }, 'feat/validate-signup'],
    ['T-20261109-1200', { kind: 'text', label: 'Description' }, 'feat/validate-signup'],
    ['T-20261109-1201', null, 'feat/validate-signup'],
  ];
  for (const [taskId, source, branch] of cases) {
    const { regions } = await taskScreen(planScreen(taskId, source));
    assert.equal(branchChip(regions['task-checkpoint']!), branch, `${source ? String(source.kind) : 'no source'}`);
  }
});

const POST_REVIEW = {
  taskId: 'api-pr-12',
  source: { kind: 'pr', label: 'acme/api#12', url: 'https://github.com/acme/api/pull/12' },
  status: { key: 'waiting', tone: 'warn', label: 'Post the review', resumable: false },
  checkpointFull: { id: 'post-review', options: ['post', 'skip'], at: 'now' },
  checkpointContext: {
    format: 'markdown',
    text: 'Posted to https://github.com/acme/api/pull/12 as you choose, not before.',
    review: {
      url: 'https://github.com/acme/api/pull/12',
      items: [
        { id: '0.0', agent: 'reviewer', severity: 'major', problem: 'bet() never checks <CAP>', fix: 'refuse x > CAP', path: 'src/cap.js', line: 2, inline: true },
        { id: '1.0', agent: 'appsec-reviewer', severity: 'minor', problem: 'log the refusal', inline: false },
      ],
    },
  },
};

test('task page: a reviewed pull request asks before its review is posted, and shows what would be', async () => {
  const { regions } = await taskScreen(POST_REVIEW);
  const cp = regions['task-checkpoint']!;
  assert.match(cp, /<h2>Post the review to the pull request\?<\/h2>/);
  assert.match(cp, /<h4>Comments on the changed lines<\/h4><div class="rv-list"><label class="rv-item sev-major"><input type="checkbox" class="rv-pick" data-id="0\.0" checked><span class="sev">major<\/span><span class="grow"><code>src\/cap\.js:2<\/code> bet\(\) never checks &lt;CAP&gt;<span class="muted"> → refuse x &gt; CAP<\/span><\/span><span class="muted small">reviewer<\/span><\/label><\/div>/, 'escaped, ticked');
  assert.match(cp, /<h4>In the summary comment<\/h4><div class="rv-list"><label class="rv-item sev-minor"><input type="checkbox" class="rv-pick" data-id="1\.0" checked>/);
  assert.match(cp, /<details class="log-details"><summary>As it would be posted<\/summary><div class="doc-frame"><div class="markdown"><p>Posted to [^<]* as you choose, not before\.<\/p>/);
  assert.match(cp, /data-option="post" data-kind="primary"[^>]*>[\s\S]*?Post the review<\/button>/);
  assert.match(cp, /data-option="skip"[^>]*>[\s\S]*?Finish without posting<\/button>/);
  assert.match(cp, /<div class="cp-icon"><i data-icon="pr"><\/i><\/div>/);

  const none = await taskScreen({ ...POST_REVIEW, checkpointContext: { ...POST_REVIEW.checkpointContext, review: { url: 'u', items: [] } } });
  assert.match(none.regions['task-checkpoint']!, /The reviewers found nothing: only the summary with their verdicts goes\./);
});

test('task page: posting sends the findings you unticked, and skipping sends none', async () => {
  const button = () => ({ dataset: { option: 'post' }, classList: { add() {}, remove() {} } });
  const boxes = { '.rv-pick': [{ checked: true, dataset: { id: '0.0' } }, { checked: false, dataset: { id: '1.0' } }] };
  const posting = await taskScreen(POST_REVIEW, { elements: boxes });
  await posting.view.actions.answer!(button());
  assert.deepEqual(sent(posting.calls), [['answer', { taskId: 'api-pr-12', checkpointId: 'post-review', option: 'post', at: 'now', omit: ['1.0'] }]]);

  const all = await taskScreen(POST_REVIEW, { elements: { '.rv-pick': [{ checked: true, dataset: { id: '0.0' } }] } });
  await all.view.actions.answer!(button());
  assert.deepEqual(sent(all.calls), [['answer', { taskId: 'api-pr-12', checkpointId: 'post-review', option: 'post', at: 'now' }]], 'everything ticked: nothing left out');

  const skipping = await taskScreen(POST_REVIEW, { elements: boxes });
  await skipping.view.actions.answer!({ ...button(), dataset: { option: 'skip' } });
  assert.deepEqual(sent(skipping.calls), [['answer', { taskId: 'api-pr-12', checkpointId: 'post-review', option: 'skip', at: 'now' }]]);
});

test("task page: a split ticket lists its sub-tasks, each opening its task, and asks whether it still works as one", async () => {
  const { regions } = await taskScreen({
    taskId: 'CP-1124',
    source: { kind: 'jira', label: 'CP-1124', url: 'https://acme.atlassian.net/browse/CP-1124' },
    status: { key: 'waiting', tone: 'warn', label: 'Sub-tasks added', resumable: false },
    checkpointFull: { id: 'split', options: ['close', 'continue'], at: 'now' },
    checkpointContext: { format: 'markdown', text: '', children: ['CP-1164', 'CP-1165'] },
  });
  const cp = regions['task-checkpoint']!;
  assert.match(cp, /<h2>Sub-tasks added<\/h2>/);
  assert.match(cp, /<div class="split-list"><button class="split-row" data-action="open-task" data-id="CP-1164">[\s\S]*?<b>CP-1164<\/b>[\s\S]*?<button class="split-row" data-action="open-task" data-id="CP-1165">/);
  assert.match(cp, /data-option="close" data-kind="primary"[^>]*>[\s\S]*?Close this task<\/button>/);
  assert.match(cp, /data-option="continue"[^>]*>[\s\S]*?Work on the whole ticket too<\/button>/);
});

/** The task screen with the shell's awake menu recorded: what it was drawn with, and the picks it turns into choices. */
async function awakeScreen(screen: Record<string, unknown>) {
  const drawn: unknown[] = [];
  const shell = {
    awakeMenu: (opts: unknown) => (drawn.push(JSON.parse(JSON.stringify(opts))), '<span class="awake-menu"></span>'),
    awakePick: (v: string) => (v === 'run' ? { minutes: null } : v === 'off' ? null : { minutes: Number(v) }),
    awakeHours: (v: string) => (Number(v) > 0 ? { minutes: Math.round(Number(v) * 60) } : null),
    closeMenus: () => {},
  };
  return { ...(await taskScreen(screen, { shell })), drawn };
}

test('task page: a running task offers to keep the computer awake, shows what it has left, and changes or stops it', async () => {
  const running = { status: { key: 'running', tone: 'accent', label: 'Running', group: 'running', resumable: false } };
  const off = await awakeScreen({ ...running, awake: null });
  assert.deepEqual(off.drawn, [{ scope: 'task', choice: null, until: null }]);

  const unlimited = await awakeScreen({ ...running, awake: { until: null } });
  assert.deepEqual(unlimited.drawn, [{ scope: 'task', choice: { minutes: null }, until: null }], 'as long as it runs');

  const until = Date.now() + 90 * 60_000;
  const timed = await awakeScreen({ ...running, awake: { until } });
  const [opts] = timed.drawn as { scope: string; choice: { minutes: number }; until: number }[];
  assert.equal(opts!.until, until);
  assert.ok(Math.abs(opts!.choice.minutes - 90) <= 1, 'what it has left, in minutes');

  const done = await awakeScreen({ status: { key: 'done', tone: 'ok', label: 'Done', group: 'done', resumable: false }, awake: null });
  assert.deepEqual(done.drawn, [], 'a finished task has nothing to keep awake');

  await timed.view.actions['task-awake']!({ dataset: { minutes: '120' } });
  await timed.view.actions['task-awake']!({ dataset: { minutes: 'off' } });
  await timed.view.changes['task-awake-hours']!({ value: '1.5' });
  await timed.view.changes['task-awake-hours']!({ value: 'soon' });
  assert.deepEqual(sent(timed.calls), [
    ['setAwake', { taskId: 'T-1', awake: { minutes: 120 } }],
    ['setAwake', { taskId: 'T-1', awake: null }],
    ['setAwake', { taskId: 'T-1', awake: { minutes: 90 } }],
  ], 'hours that are no number send nothing');
});

test('task page: a task never run is started with Start, one stopped is resumed', async () => {
  const notStarted = await taskScreen({ status: { key: 'ready', tone: 'muted', label: 'Not started', group: 'stopped', resumable: true }, phase: 'intake', checkpointFull: null });
  assert.match(notStarted.regions['task-header'] ?? '', /data-action="run"><i data-icon="play"><\/i>Start<\/button>/);
  const stopped = await taskScreen({ status: { key: 'ready', tone: 'muted', label: 'Ready to continue', group: 'stopped', resumable: true }, phase: 'stages', checkpointFull: null });
  assert.match(stopped.regions['task-header'] ?? '', /data-action="run"><i data-icon="play"><\/i>Resume<\/button>/);
});

test("task page: a split ticket's sub-tasks are listed with their titles and states, as the side rail has them", async () => {
  const card = (taskId: string, title: string) => ({ taskId, title, status: { label: 'Not started' } });
  const { regions } = await taskScreen(
    {
      taskId: 'CP-1124',
      status: { key: 'waiting', tone: 'warn', label: 'Sub-tasks added', resumable: false },
      checkpointFull: { id: 'split', options: ['close', 'continue'], at: 'now' },
      checkpointContext: { format: 'markdown', text: '', children: ['CP-1164', 'CP-1165'] },
    },
    { overview: { tasks: [card('CP-1164', 'CP-1164 [BE] RNG: seeds <per round>'), card('CP-1165', 'CP-1165 [FE] RNG panel')] } },
  );
  const cp = regions['task-checkpoint']!;
  assert.match(cp, /<b>CP-1164<\/b><span class="tt-title">\[BE\] RNG: seeds &lt;per round&gt;<\/span><span class="muted small">Not started<\/span>/, 'its key once, the title escaped');
  assert.match(cp, /<b>CP-1165<\/b><span class="tt-title">\[FE\] RNG panel<\/span>/);
});
