// Claude Code in a terminal with Claudestrator in context: what the session is told of the workspace (its repos,
// agents, scenarios, tasks and where their files are), Claudestrator's agents as the session's subagents, and the
// bridge it runs scenarios through. The session is yours: Claude Code asks you before it changes anything, as always.
import * as path from 'path';
import { mcpServerAllowed, mcpToolPrefix } from './mcp';
import type { Agent, Config } from './types';

/** The scenarios every workspace has (unless removed), as the dashboard names them. */
const BUILTIN_SCENARIOS: readonly { id: string; label: string; description: string }[] = [
  { id: 'deliver', label: 'Deliver', description: 'Plan → your approval → code and tests per repo → review → draft PRs' },
  { id: 'readiness', label: 'Check readiness', description: 'Finds the work for a ticket and checks every acceptance criterion. Changes nothing.' },
  { id: 'audit', label: 'Audit', description: 'Looks for bugs, bottlenecks, performance and security issues; a report rated critical / high / medium / low. Changes nothing.' },
];

/** The bridge's name in the session: its tools are `mcp__claudestrator__<tool>`. */
const BRIDGE_NAME = 'claudestrator';

/** What a subagent of Claude Code is (`--agents`): its prompt, and optionally its tools and model. */
interface SubagentDef {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

interface ScenarioLine {
  id: string;
  label: string;
  description: string;
}

/** A task as the session is told of it. */
interface TaskLine {
  taskId: string;
  title: string;
  scenario: string;
  status: string;
  updatedAt: string;
}

/** The workspace's scenarios: the built-in ones not removed, then its own (built in, from libraries, or written). */
function scenarioLines(config: Pick<Config, 'custom' | 'removedScenarios'>): ScenarioLine[] {
  const own = Object.values(config.custom).map((c) => ({ id: c.id, label: c.label, description: c.description || '' }));
  return [...BUILTIN_SCENARIOS.filter((s) => !config.removedScenarios.includes(s.id)), ...own];
}

/** Said to an agent run as a subagent: it is not in a task, and nothing reads its report as JSON. */
const AS_SUBAGENT = `

---
Here you run as a subagent of a Claude Code session the user opened in a terminal, not as a step of a Claudestrator task: there is no task, no branch Claudestrator made, no checkpoint. Work in the folders the session gives you. Where the instructions above ask for a report as JSON or in a json block, give the same content as a short report in plain text instead: the session that called you reads it.`;

/**
 * Claudestrator's agents as Claude Code subagents of the same names, for `--agents`: their instructions, their model,
 * and their tools. A tool rule (`WebFetch(domain:…)`) becomes its tool: in your session Claude Code asks you before it
 * runs anything you have not allowed. The MCP servers of an agent are named one by one, of `servers` (the account's).
 */
function terminalAgents(config: Pick<Config, 'agents'>, servers: readonly string[]): Record<string, SubagentDef> {
  const out: Record<string, SubagentDef> = {};
  for (const a of Object.values(config.agents)) {
    const builtIn = [...new Set((a.tools || []).filter((t) => !t.startsWith('mcp__')).map((t) => t.replace(/\(.*$/, '')))];
    const mcp = a.mcp === false ? [] : servers.filter((s) => mcpServerAllowed(a, s)).map(mcpToolPrefix);
    out[a.name] = {
      description: `${a.description} Claudestrator's ${a.name} agent (${a.output}): use it when the user asks for this agent or its kind of work.`,
      prompt: `${a.instructions}${AS_SUBAGENT}`,
      ...(builtIn.length && { tools: [...builtIn, ...mcp] }),
      ...(a.model && a.model !== 'inherit' && { model: a.model }),
    };
  }
  return out;
}

const agentLine = (a: Agent): string => `- ${a.name} (${a.output}${a.model && a.model !== 'inherit' ? `, ${a.model}` : ''}${a.effort ? `, effort ${a.effort}` : ''}${a.enabled ? '' : ', switched off in the pipeline'}): ${a.description}`;

interface PromptArgs {
  workspace: string;
  config: Config;
  /** The config file of the workspace, when it has one. */
  configFile: string | null;
  /** The latest tasks, newest first. */
  tasks: readonly TaskLine[];
}

/** How many tasks the prompt lists; the bridge's list_tasks has the rest. */
const TASKS_LISTED = 15;

/** What the session is told, after Claude Code's own system prompt (`--append-system-prompt`). */
function terminalPrompt({ workspace, config, configFile, tasks }: PromptArgs): string {
  const tool = (name: string): string => `mcp__${BRIDGE_NAME}__${name}`;
  const repos = Object.values(config.repos).map((r) => `- ${r.name}: ${path.resolve(workspace, r.path)} (base branch ${r.baseBranch}${r.role ? `; ${r.role}` : ''})`);
  const scenarios = scenarioLines(config).map((s) => `- ${s.id}: ${s.label}${s.description ? `. ${s.description}` : ''}`);
  const listed = tasks.slice(0, TASKS_LISTED).map((t) => `- ${t.taskId}: ${t.title} (${t.scenario}, ${t.status}, updated ${t.updatedAt})`);
  return [
    `# Claudestrator`,
    `The user opened this session from Claudestrator, which runs pipelines of Claude Code agents on the workspace ${workspace}: a plan, the user's approval, code and tests per repo, a review with fix rounds, then draft PRs, each run a task with its own branch, sandbox and checkpoints, shown in Claudestrator's dashboard. Answer any request; use its agents and scenarios when they fit.`,
    ``,
    `## Repos`,
    ...(repos.length ? repos : ['- none configured yet']),
    ``,
    `## Agents`,
    `Each is also your subagent of the same name, with its own instructions and model: hand it the work when the user names it or asks for what it does.`,
    ...Object.values(config.agents).map(agentLine),
    ``,
    `## Scenarios`,
    `A scenario runs as a Claudestrator task, never by hand here: start it with ${tool('start_task')} (text: what to do, a Jira key, an issue or pull request link; scenario: one of the ids below; leave it out and the text picks one). The task runs in Claudestrator, in its sandbox, on its own branch; it stops at its checkpoints (the plan's approval, the push) for the user. Follow it with ${tool('task_status')}, answer a checkpoint with ${tool('answer_checkpoint')} only with the user's answer, and use ${tool('list_tasks')}, ${tool('stop_task')} and ${tool('resume_task')}.`,
    ...scenarios,
    ``,
    `## Tasks`,
    `Each task's files are in ${path.join(workspace, '.orch', 'tasks')}/<task id>/: its event log (events.jsonl), the agents' transcripts, plans, reports and check logs. Read them to say what happened in a task and why.`,
    ...(listed.length ? listed : ['- none yet']),
    ``,
    `## Config`,
    configFile ? `The workspace's config is ${configFile}: its agents, scenarios, repos and checks. Change it only when the user asks; the dashboard reads it again on its own.` : `The workspace has no config file yet: Claudestrator's dashboard sets one up.`,
  ].join('\n');
}

/** The session's MCP config: the bridge, on the loopback, with the token only this session is given. */
function bridgeMcpConfig({ url, token }: { url: string; token: string }): { mcpServers: Record<string, unknown> } {
  return { mcpServers: { [BRIDGE_NAME]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } };
}

/** What `claude` is started with: the prompt, the subagents, the bridge, and the repos outside the workspace. */
function terminalArgs({ prompt, agents, mcpConfig, addDirs }: { prompt: string; agents: Record<string, SubagentDef>; mcpConfig: string; addDirs: readonly string[] }): string[] {
  return ['--append-system-prompt', prompt, '--agents', JSON.stringify(agents), '--mcp-config', mcpConfig, ...(addDirs.length ? ['--add-dir', ...addDirs] : [])];
}

export type { ScenarioLine, SubagentDef, TaskLine };
export { BRIDGE_NAME, bridgeMcpConfig, scenarioLines, terminalAgents, terminalArgs, terminalPrompt };
