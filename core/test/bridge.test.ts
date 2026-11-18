// Claude Code in a terminal with Claudestrator in context: the bridge it reaches the engine through (an MCP server on
// the loopback), and what the session is told and given (its prompt, Claudestrator's agents as its subagents).
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

import { BridgeServer, engineOps, handleMessage, TOOLS, type BridgeOps } from '../src/bridge';
import { bridgeMcpConfig, scenarioLines, terminalAgents, terminalArgs, terminalPrompt } from '../src/terminal';
import { loadConfig } from '../src/config';
import { harness, waitFor, workspace } from './helpers/e2e';
import type { Config } from '../src/types';

/** Operations that record what they were asked, and answer as a workspace with one task would. */
function fakeOps() {
  const asked: unknown[] = [];
  const ops: BridgeOps = {
    scenarios: async () => [{ id: 'deliver', label: 'Deliver', description: 'Plan → …' }],
    tasks: async () => [{ taskId: 'T-1', title: 'Cap bets', scenario: 'deliver', status: 'Approve the plan', updatedAt: '2026-11-18T10:00:00Z' }],
    task: async (taskId) => {
      if (taskId !== 'T-1') throw new Error(`there is no task ${taskId}`);
      return { taskId, title: 'Cap bets', scenario: 'deliver', status: 'Approve the plan', phase: 'stages', branch: null, prs: {}, costUsd: 0.1, taskDir: '/ws/.orch/tasks/T-1', steps: [], checkpoint: { id: 'approve-plan', options: ['approve', 'change', 'stop'], text: '## Summary' }, error: null };
    },
    start: async (args) => (asked.push(['start', args]), { taskId: 'T-2', created: true }),
    answer: async (args) => void asked.push(['answer', args]),
    stop: async (taskId) => void asked.push(['stop', taskId]),
    resume: async (taskId) => void asked.push(['resume', taskId]),
  };
  return { ops, asked };
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });
const textOf = (reply: unknown): string => ((reply as { result: { content: { text: string }[] } }).result.content[0]!.text);

test('bridge: it speaks MCP: initialize, its tools, a call, a notification and a method it does not have', async () => {
  const { ops, asked } = fakeOps();
  assert.deepEqual(await handleMessage(ops, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code' } } }), {
    jsonrpc: '2.0',
    id: 1,
    result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'claudestrator', version: '1' } },
  });
  assert.equal(await handleMessage(ops, { jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'a notification gets no reply');
  const list = (await handleMessage(ops, { jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), ['list_scenarios', 'list_tasks', 'task_status', 'start_task', 'answer_checkpoint', 'stop_task', 'resume_task']);
  assert.deepEqual(await handleMessage(ops, { jsonrpc: '2.0', id: 3, method: 'resources/list' }), { jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'no method resources/list' } });

  assert.match(textOf(await handleMessage(ops, call('task_status', { taskId: 'T-1' }))), /"options": \[\s*"approve",/);
  const started = JSON.parse(textOf(await handleMessage(ops, call('start_task', { text: ' Cap bets at 100 ', scenario: 'deliver' })))) as { taskId: string };
  assert.equal(started.taskId, 'T-2');
  await handleMessage(ops, call('answer_checkpoint', { taskId: 'T-1', option: 'approve', feedback: 'go' }));
  await handleMessage(ops, call('stop_task', { taskId: 'T-1' }));
  await handleMessage(ops, call('resume_task', { taskId: 'T-1' }));
  assert.deepEqual(asked, [
    ['start', { text: 'Cap bets at 100', scenario: 'deliver' }],
    ['answer', { taskId: 'T-1', option: 'approve', feedback: 'go' }],
    ['stop', 'T-1'],
    ['resume', 'T-1'],
  ]);

  // What goes wrong is the tool's error, for the session to read; nothing is asked of the engine.
  const bad = (await handleMessage(ops, call('start_task', { text: '', auto: 'yes' }))) as { result: { isError: boolean } };
  assert.equal(bad.result.isError, true);
  assert.match(textOf(await handleMessage(ops, call('task_status', { taskId: 'T-9' }))), /there is no task T-9/);
  assert.equal(asked.length, 4);
});

test('bridge: only a session with its token reaches it, over the loopback, and no page in a browser', async () => {
  const server = new BridgeServer(fakeOps().ops);
  const { url, token } = await server.listen();
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const post = (headers: Record<string, string>, body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list' }) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal((await post({})).status, 401, 'no token');
    assert.equal((await post({ Authorization: 'Bearer nope' })).status, 401, 'another token');
    assert.equal((await post({ ...auth, Origin: 'https://evil.example' })).status, 401, 'a page in a browser');
    const ok = await post(auth);
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { result: { tools: unknown[] } }).result.tools.length, TOOLS.length);
    assert.equal((await post(auth, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    assert.equal((await fetch(url, { headers: auth })).status, 405, 'no stream of its own');
    assert.equal((await server.listen()).url, url, 'one server, however many terminals');
  } finally {
    server.dispose();
  }
});

test('bridge: a task started from a terminal runs in the engine, stops at its plan, and goes on with the answer given', async () => {
  const ws = workspace(['api'], 'repos:\n  api: {}\n');
  const h = await harness(ws, { FAKE_REPOS: 'api' });
  const ops = engineOps(() => h.engine);
  try {
    assert.ok((await ops.scenarios()).some((s) => s.id === 'deliver'));
    const { taskId, created } = await ops.start({ text: 'Add the feature' });
    assert.ok(created);
    const waiting = await waitFor(async () => {
      const t = await ops.task(taskId);
      return t.checkpoint ? t : null;
    }, 60000);
    assert.equal(waiting.checkpoint!.id, 'approve-plan');
    assert.ok(waiting.checkpoint!.options.includes('approve'));
    assert.match(waiting.checkpoint!.text, /## Summary/, "the plan, as the dashboard shows it");
    assert.equal(waiting.taskDir, path.join(ws, '.orch', 'tasks', taskId));
    assert.deepEqual((await ops.tasks()).map((t) => t.taskId), [taskId]);

    await assert.rejects(() => ops.answer({ taskId, option: 'push' }), /push is not an answer to approve-plan; choose one of approve/);
    await ops.answer({ taskId, option: 'approve' });
    const next = await waitFor(async () => {
      const t = await ops.task(taskId);
      return t.checkpoint && t.checkpoint.id !== 'approve-plan' ? t : null;
    }, 60000);
    assert.equal(next.checkpoint!.id, 'confirm-push');
    assert.ok(next.steps.some((x) => x.agent === 'developer' && x.repo === 'api'));
  } finally {
    await h.engine.stop((await ops.tasks())[0]?.taskId ?? '').catch(() => {});
    h.hooks.dispose();
  }
});

test('terminal: the session is told the repos, agents, scenarios and tasks, and given the agents as subagents', async () => {
  const ws = workspace(['api'], 'repos:\n  api: { role: the bets API }\nagents:\n  watcher: { extends: auditor, description: Reads the dashboards., model: haiku, mcp: true, mcpServers: [Grafana], tools: [Read, "WebFetch(domain:grafana.acme.com)", mcp__Grafana__get_dashboard_by_uid] }\n');
  const r = await loadConfig({ workspace: ws, home: path.join(ws, 'home') });
  assert.ok(r.ok);
  const config: Config = r.config;
  const prompt = terminalPrompt({ workspace: ws, config, configFile: path.join(ws, '.claudestrator', 'config.yaml'), tasks: [{ taskId: 'T-1', title: 'Cap bets', scenario: 'deliver', status: 'Approve the plan', updatedAt: '2026-11-18' }] });
  assert.ok(prompt.includes(`- api: ${path.join(ws, 'api')} (base branch main; the bets API)`), prompt);
  assert.match(prompt, /- watcher \(audit, haiku[^)]*\): Reads the dashboards\./);
  assert.match(prompt, /- deliver: Deliver\. Plan → your approval/);
  assert.match(prompt, /start it with mcp__claudestrator__start_task/);
  assert.match(prompt, /- T-1: Cap bets \(deliver, Approve the plan, updated 2026-11-18\)/);
  assert.ok(prompt.includes(path.join(ws, '.orch', 'tasks')));

  const agents = terminalAgents(config, ['Grafana', 'Atlassian', 'claude.ai Slack']);
  const watcher = agents.watcher!;
  assert.deepEqual(watcher.tools, ['Read', 'WebFetch', 'mcp__Grafana'], 'its own servers only; a rule becomes its tool');
  assert.equal(watcher.model, 'haiku');
  assert.match(watcher.prompt, /subagent of a Claude Code session the user opened in a terminal/);
  assert.match(watcher.description, /^Reads the dashboards\. Claudestrator's watcher agent \(audit\)/);
  assert.deepEqual(agents.developer!.tools!.filter((t) => t.startsWith('mcp__')), [], 'an agent without MCP servers gets none');
  assert.deepEqual(agents.planner!.tools!.filter((t) => t.startsWith('mcp__')), ['mcp__Grafana', 'mcp__Atlassian', 'mcp__claude_ai_Slack'], 'one with every server gets each');

  assert.deepEqual(scenarioLines({ custom: {}, removedScenarios: ['audit'] }).map((s) => s.id), ['deliver', 'readiness'], 'a removed scenario is not offered');
  assert.deepEqual(bridgeMcpConfig({ url: 'http://127.0.0.1:1/mcp', token: 't' }), { mcpServers: { claudestrator: { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer t' } } } });
  const args = terminalArgs({ prompt: 'P', agents: { a: { description: 'd', prompt: 'p' } }, mcpConfig: '/m.json', addDirs: ['/elsewhere'] });
  assert.deepEqual(args, ['--append-system-prompt', 'P', '--agents', '{"a":{"description":"d","prompt":"p"}}', '--mcp-config', '/m.json', '--add-dir', '/elsewhere']);
  fs.rmSync(ws, { recursive: true, force: true });
});
