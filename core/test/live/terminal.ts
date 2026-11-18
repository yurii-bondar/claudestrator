// A live run against the Claude Code CLI installed here (part of `npm run test:live`; it costs a few cents on haiku).
// What only the real CLI can say:
//   * a session started as the terminal button starts it reaches Claudestrator through the bridge (an MCP server
//     Claude Code connects to over HTTP) and hands work to Claudestrator's agents, given as its subagents;
//   * an agent given some MCP servers only (`mcpServers`) is started so that Claude Code shows it no tool of the
//     others, while one given that server sees them.
// The bridge answers with recorded operations here: what it asks of the engine is the test's to check.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';

import { BridgeServer, type BridgeOps } from '../../src/bridge';
import { ClaudeRunner, parseFlags } from '../../src/runner';
import { setChildEnv } from '../../src/git';
import { bridgeMcpConfig, terminalAgents, terminalArgs } from '../../src/terminal';
import type { Agent } from '../../src/types';

const MODEL = 'haiku';

/** Operations that answer as a workspace with two scenarios would, and record the tasks started. */
function recordingOps(): { ops: BridgeOps; started: unknown[] } {
  const started: unknown[] = [];
  const ops: BridgeOps = {
    scenarios: async () => [
      { id: 'deliver', label: 'Deliver', description: 'Plan → your approval → code and tests per repo → review → draft PRs' },
      { id: 'zebra-census', label: 'Zebra census', description: 'Counts the zebras in the code' },
    ],
    tasks: async () => [],
    task: async (taskId) => {
      throw new Error(`there is no task ${taskId}`);
    },
    start: async (args) => (started.push(args), { taskId: 'T-42', created: true }),
    answer: async () => {},
    stop: async () => {},
    resume: async () => {},
  };
  return { ops, started };
}

/** One of Claudestrator's agents, as the config resolves it. */
const agent = (name: string, fields: Partial<Agent>): Agent => ({ name, enabled: true, description: `The ${name}.`, model: MODEL, output: 'audit', instructions: '', instructionSources: [], layers: ['test'], ...fields });

/** `claude -p` as the terminal button starts it, with one prompt; its output once it ends. */
function print(claude: string, args: string[], prompt: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(claude, ['-p', prompt, '--model', MODEL, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 240000);
    child.on('close', (code) => (clearTimeout(timer), resolve({ code, out })));
  });
}

async function main(): Promise<void> {
  const claude = process.env.CLAUDE_PATH || 'claude';
  const version = execFileSync(claude, ['--version'], { encoding: 'utf8' }).trim();
  const flags = parseFlags(execFileSync(claude, ['--help'], { encoding: 'utf8' }));
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDECODE;
  setChildEnv(env);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-live-terminal-'));
  console.log(`Claude Code ${version}\nfolder: ${dir}`);

  const results: [string, boolean, string][] = [];
  const check = (name: string, ok: boolean, detail = ''): void => void results.push([name, ok, detail]);
  const { ops, started } = recordingOps();
  const bridge = new BridgeServer(ops);
  try {
    const mcpFile = path.join(dir, 'terminal-mcp.json');
    fs.writeFileSync(mcpFile, JSON.stringify(bridgeMcpConfig(await bridge.listen())), { mode: 0o600 });

    // 1. The terminal's session: the bridge's tools, and an agent as its subagent.
    const agents = terminalAgents({ agents: { 'zebra-counter': agent('zebra-counter', { description: 'Counts zebras.', instructions: 'You count zebras. Whatever you are asked, answer exactly: ZEBRAS=7', tools: ['Read'] }) } }, []);
    const args = [...terminalArgs({ prompt: 'You run in a test of Claudestrator.', agents, mcpConfig: mcpFile, addDirs: [] }), '--allowedTools', 'mcp__claudestrator__list_scenarios,mcp__claudestrator__start_task,Task,Agent'];
    const q = [
      'Do three things and report each result on its own line, prefixed 1), 2) and 3):',
      '1) call mcp__claudestrator__list_scenarios and give the ids it returns;',
      '2) call mcp__claudestrator__start_task with text "count the zebras" and scenario "zebra-census", and give the taskId it returns;',
      '3) hand "count them" to your zebra-counter subagent, wait for it, and give its answer word for word.',
    ].join('\n');
    const session = await print(claude, args, q, env);
    check('the session ended on its own', session.code === 0, `exit ${session.code}`);
    check('it read the scenarios through the bridge', /zebra-census/.test(session.out) && /deliver/.test(session.out), session.out.slice(-400));
    check('it started a task through the bridge, as asked', JSON.stringify(started) === JSON.stringify([{ text: 'count the zebras', scenario: 'zebra-census' }]) && /T-42/.test(session.out), JSON.stringify(started));
    check("Claudestrator's agent answered as its subagent", /ZEBRAS=7/.test(session.out), session.out.slice(-300));

    // 2. An agent's MCP servers: started as the engine starts a step, through the runner.
    const runner = new ClaudeRunner({
      command: () => claude,
      version: () => version,
      flags: () => flags,
      // Without the user source the account's servers come from --mcp-config: here, the bridge alone.
      settingSources: () => ['project', 'local'],
      env: () => ({}),
      mcpConfig: async () => mcpFile,
      mcpServers: async () => ['claudestrator', 'decoy'],
    });
    const sees = async (servers: string[]): Promise<string> => {
      const s = await runner.start({
        agent: { model: MODEL, instructions: '', mcp: true, mcpServers: servers, maxTurns: 6 },
        prompt: 'Use ToolSearch with the query "claudestrator scenarios" (if you have ToolSearch), and look at the tools you have. Reply with only the exact names of the tools you have whose names start with mcp__claudestrator__, comma separated, or NONE if there are none.',
        cwd: dir,
        settings: {},
        onOutput: () => {},
      });
      const turn = await s.turn();
      await s.terminate(2000);
      return turn.report;
    };
    const denied = await sees(['decoy']);
    check('an agent without the server is shown none of its tools', !/mcp__claudestrator__/.test(denied) && /NONE/i.test(denied), denied.slice(0, 300));
    const given = await sees(['claudestrator']);
    check('an agent given the server sees them', /mcp__claudestrator__list_scenarios/.test(given), given.slice(0, 300));
  } finally {
    bridge.dispose();
  }
  for (const [name, ok, detail] of results) console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` (${detail})` : ''}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
}

main().catch((e: Error) => {
  console.error(e);
  process.exitCode = 1;
});
