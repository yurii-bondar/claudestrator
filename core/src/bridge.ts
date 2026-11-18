// The bridge from a Claude Code session in a terminal to Claudestrator: an MCP server (Streamable HTTP, JSON answers
// only) on the loopback, which only a session started with its token reaches. Through it the session lists scenarios
// and tasks, starts a task, follows it, answers its checkpoint, stops and resumes it: the engine does the work, as for a
// task started in the dashboard, which shows it.
import * as http from 'http';
import * as crypto from 'crypto';
import type { Engine } from './engine';
import { scenarioLines, type ScenarioLine, type TaskLine } from './terminal';
import * as view from './view';

/** A task as task_status answers: where it is, what it waits for, and where its files are. */
interface TaskReport {
  taskId: string;
  title: string;
  scenario: string;
  status: string;
  phase: string;
  branch: string | null;
  prs: Record<string, string>;
  costUsd: number;
  taskDir: string;
  steps: { agent: string; repo?: string; status: string }[];
  /** The question it waits at: its options, and what the dashboard shows with it. */
  checkpoint: { id: string; options: string[]; text: string } | null;
  error: string | null;
}

/** What the bridge does, as the host gives it: over its engine of the moment. */
interface BridgeOps {
  scenarios(): Promise<ScenarioLine[]>;
  tasks(): Promise<TaskLine[]>;
  task(taskId: string): Promise<TaskReport>;
  start(args: { text: string; scenario?: string; auto?: boolean }): Promise<{ taskId: string; created: boolean }>;
  answer(args: { taskId: string; option: string; feedback?: string }): Promise<void>;
  stop(taskId: string): Promise<void>;
  resume(taskId: string): Promise<void>;
}

/** How much of a checkpoint's text task_status carries: a plan can be long, and the session can read its file. */
const CHECKPOINT_TEXT = 20000;

/** The bridge's operations over `engineOf()`: the engine of the workspace open now. */
function engineOps(engineOf: () => Engine | null): BridgeOps {
  const engine = (): Engine => {
    const e = engineOf();
    if (!e) throw new Error('Claudestrator has no workspace open');
    return e;
  };
  return {
    async scenarios() {
      return scenarioLines(await engine().config());
    },
    async tasks() {
      const e = engine();
      const cards = await Promise.all((await e.svc.list()).map((entry) => view.summary(e, entry)));
      return cards
        .map((c) => ({ taskId: c.taskId, title: c.title, scenario: c.scenarioLabel || c.scenario, status: c.status.label, updatedAt: c.updatedAt }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async task(taskId) {
      const e = engine();
      const d = await view.detail(e, taskId);
      const s = await e.svc.state(taskId);
      const cp = s.checkpoint;
      const context = cp ? await e.checkpointContext(s, cp).catch(() => null) : null;
      return {
        taskId,
        title: d.title,
        scenario: d.scenarioLabel || d.scenario,
        status: d.status.label,
        phase: d.phase,
        branch: d.branch,
        prs: d.prs,
        costUsd: d.cost,
        taskDir: d.taskDir,
        steps: d.steps.filter((x) => x.agent).map((x) => ({ agent: x.agent!, ...(x.repo && { repo: x.repo }), status: x.status })),
        checkpoint: cp ? { id: cp.id, options: cp.options, text: ((context && context.text) || cp.reason || '').slice(0, CHECKPOINT_TEXT) } : null,
        error: d.error && d.error.message ? d.error.message : null,
      };
    },
    async start({ text, scenario, auto }) {
      const e = engine();
      const r = await e.start({ text, ...(scenario && { scenario }), ...(auto !== undefined && { auto }) });
      e.launch(r.taskId);
      return r;
    },
    async answer({ taskId, option, feedback }) {
      const e = engine();
      const cp = (await e.svc.state(taskId)).checkpoint;
      if (!cp) throw new Error(`${taskId} waits for no answer now`);
      if (!cp.options.includes(option)) throw new Error(`${option} is not an answer to ${cp.id}; choose one of ${cp.options.join(', ')}`);
      await e.answer(taskId, cp.id, option, { ...(feedback && { feedback }), at: cp.at });
    },
    async stop(taskId) {
      await engine().stop(taskId);
    },
    async resume(taskId) {
      await engine().resume(taskId);
    },
  };
}

// ---------- the MCP server ----------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TASK_ID = { taskId: { type: 'string', description: 'The task id, as list_tasks gives it' } };
const TOOLS: readonly ToolDef[] = [
  { name: 'list_scenarios', description: "The workspace's scenarios: their ids, names and what each does.", inputSchema: { type: 'object', properties: {} } },
  { name: 'list_tasks', description: "Claudestrator's tasks in this workspace, newest first: id, title, scenario, status.", inputSchema: { type: 'object', properties: {} } },
  { name: 'task_status', description: 'A task: its status, its steps, the checkpoint it waits at (its options and what it shows), its branch, PRs, cost and the folder of its files.', inputSchema: { type: 'object', properties: TASK_ID, required: ['taskId'] } },
  {
    name: 'start_task',
    description: 'Starts a Claudestrator task that runs a scenario, as the dashboard would: in its sandbox, on its own branch, stopping at its checkpoints for the user. Returns its id.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to do, in plain words; or a Jira key, an issue link or a pull request link' },
        scenario: { type: 'string', description: 'A scenario id from list_scenarios; left out, the text picks one (deliver by default)' },
        auto: { type: 'boolean', description: "Deliver only: true goes on without the plan's approval. Only when the user says so" },
      },
      required: ['text'],
    },
  },
  {
    name: 'answer_checkpoint',
    description: "Answers the checkpoint a task waits at, with one of its options (task_status lists them). Only with the user's own answer.",
    inputSchema: { type: 'object', properties: { ...TASK_ID, option: { type: 'string' }, feedback: { type: 'string', description: 'What the agent reads with the answer (a change to the plan, say)' } }, required: ['taskId', 'option'] },
  },
  { name: 'stop_task', description: 'Stops a task; resume_task runs it again from where it stopped.', inputSchema: { type: 'object', properties: TASK_ID, required: ['taskId'] } },
  { name: 'resume_task', description: 'Runs a stopped, failed or not yet started task from where it is.', inputSchema: { type: 'object', properties: TASK_ID, required: ['taskId'] } },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A string argument, required unless `optional`. */
function str(args: Record<string, unknown>, key: string, optional = false): string | undefined {
  const v = args[key];
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${key} must be a non-empty string`);
  return v.trim();
}

/** Runs a tool: its result as text, JSON for data. */
async function callTool(ops: BridgeOps, name: string, args: Record<string, unknown>): Promise<string> {
  const json = (v: unknown): string => JSON.stringify(v, null, 2);
  switch (name) {
    case 'list_scenarios':
      return json(await ops.scenarios());
    case 'list_tasks':
      return json(await ops.tasks());
    case 'task_status':
      return json(await ops.task(str(args, 'taskId')!));
    case 'start_task': {
      const auto = args.auto;
      if (auto !== undefined && typeof auto !== 'boolean') throw new Error('auto must be true or false');
      const scenario = str(args, 'scenario', true);
      const r = await ops.start({ text: str(args, 'text')!, ...(scenario && { scenario }), ...(auto !== undefined && { auto }) });
      return json({ ...r, note: r.created ? 'Started: it runs in Claudestrator, and its dashboard shows it. Follow it with task_status.' : 'A task for this already exists: it was not started again. See task_status.' });
    }
    case 'answer_checkpoint': {
      const feedback = str(args, 'feedback', true);
      const taskId = str(args, 'taskId')!;
      await ops.answer({ taskId, option: str(args, 'option')!, ...(feedback && { feedback }) });
      return `Answered; ${taskId} goes on.`;
    }
    case 'stop_task': {
      const taskId = str(args, 'taskId')!;
      await ops.stop(taskId);
      return `${taskId} stopped.`;
    }
    case 'resume_task': {
      const taskId = str(args, 'taskId')!;
      await ops.resume(taskId);
      return `${taskId} runs again.`;
    }
    default:
      throw new Error(`there is no tool ${name}`);
  }
}

type JsonRpcId = string | number | null;
type RpcReply = { jsonrpc: '2.0'; id: JsonRpcId; result: unknown } | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string } };

/** One JSON-RPC message: its reply, or null for a notification (which has none). */
async function handleMessage(ops: BridgeOps, msg: unknown): Promise<RpcReply | null> {
  if (!isRecord(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a JSON-RPC request' } };
  const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
  if (msg.id === undefined) return null;
  const params = isRecord(msg.params) ? msg.params : {};
  const ok = (result: unknown): RpcReply => ({ jsonrpc: '2.0', id, result });
  switch (msg.method) {
    case 'initialize':
      // The version the client asks for: this server uses nothing a version changed.
      return ok({ protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'claudestrator', version: '1' } });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      try {
        return ok({ content: [{ type: 'text', text: await callTool(ops, name, isRecord(params.arguments) ? params.arguments : {}) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
      }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `no method ${msg.method}` } };
  }
}

/** A request's body is a tool call's arguments: anything larger is refused unread. */
const MAX_BODY = 1024 * 1024;
const MCP_PATH = '/mcp';

/** The bridge's server: loopback only, one token per host, and nothing a page in a browser can reach. */
class BridgeServer {
  #server: http.Server | null = null;
  #token = crypto.randomBytes(24).toString('hex');
  #ops: BridgeOps;
  url: string | null = null;

  constructor(ops: BridgeOps) {
    this.#ops = ops;
  }

  /** Listening (once) on a port the system picks; where a session reaches it, and with which token. */
  async listen(): Promise<{ url: string; token: string }> {
    if (!this.#server) {
      await new Promise<void>((resolve, reject) => {
        const server = http.createServer((req, res) => void this.handle(req, res));
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (!addr || typeof addr === 'string') return reject(new Error('the bridge has no port'));
          this.#server = server;
          this.url = `http://127.0.0.1:${addr.port}${MCP_PATH}`;
          resolve();
        });
      });
    }
    return { url: this.url!, token: this.#token };
  }

  /** Whether a request comes from a session with the token, and not from a page (DNS rebinding, a form) in a browser. */
  #allowed(req: http.IncomingMessage): boolean {
    const host = this.url ? new URL(this.url).host : '';
    if (req.headers.origin !== undefined || req.headers.host !== host) return false;
    const given = Buffer.from((String(req.headers.authorization || '').match(/^Bearer (\S+)$/) || [])[1] || '');
    const token = Buffer.from(this.#token);
    return given.length === token.length && crypto.timingSafeEqual(given, token);
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const send = (status: number, body?: unknown): void => {
      res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (req.url !== MCP_PATH) return send(404);
    if (!this.#allowed(req)) {
      res.setHeader('Connection', 'close');
      req.resume();
      return send(401);
    }
    // No stream of server messages: a session asks, and is answered.
    if (req.method !== 'POST') {
      req.resume();
      return send(405);
    }
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk as string);
      if (size > MAX_BODY) return send(413);
      body += chunk;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(body);
    } catch {
      return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } });
    }
    const replies = (await Promise.all((Array.isArray(msg) ? msg : [msg]).map((m) => handleMessage(this.#ops, m)))).filter((r): r is RpcReply => r !== null);
    if (!replies.length) return send(202);
    send(200, Array.isArray(msg) ? replies : replies[0]);
  }

  dispose(): void {
    if (this.#server) this.#server.close();
    this.#server = null;
    this.url = null;
  }
}

export type { BridgeOps, TaskReport };
export { BridgeServer, engineOps, handleMessage, TOOLS };
