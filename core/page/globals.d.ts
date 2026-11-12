// What the dashboard scripts share. They are plain scripts loaded one after the other (markdown.js, stream.js, app.js,
// task.js, diagram-model.js, diagram-canvas.js, diagram-side.js, diagram.js, start.js, config.js), not modules: markdown.js and
// stream.js set functions on `window`, app.js publishes the shell API on `window.CS`, the diagram-*.js scripts each a
// `const` the next ones read (dgModel, dgCanvas, dgSide), and the views register themselves there. The page is built from HTML strings and DOM events.
// What the host sends comes through the types of src/wire.ts.

type Route = import('../src/wire').Route;
type Overview = import('../src/wire').Overview;
type DefaultsView = import('../src/wire').DefaultsView;
type Chip = import('../src/pipeline').Chip;
type FlowItem = import('../src/flow').FlowItem;
type FlowNode = import('../src/flow').FlowNode;
type Status = import('../src/wire').Status;
type Live = import('../src/wire').Live;
type TaskSource = import('../src/wire').TaskSource;
type PermissionRequest = import('../src/wire').PermissionRequest;
type Card = import('../src/wire').Card;
type TaskSection = import('../src/wire').TaskSection;
type AgentSummary = import('../src/wire').AgentSummary;
type ConfigSummary = import('../src/wire').ConfigSummary;
type HealthSummary = import('../src/wire').HealthSummary;
type StoredLimits = import('../src/wire').StoredLimits;
type LimitWindow = import('../src/wire').LimitWindow;
type Account = import('../src/wire').Account;
type AccountEntry = import('../src/wire').AccountEntry;
type Preview = import('../src/wire').Preview;
type HostMessage = import('../src/wire').HostMessage;
type ScenarioStep = import('../src/types').ScenarioStep;
type StepWhen = import('../src/types').StepWhen;
type Condition = import('../src/types').Condition;
type GitMode = import('../src/types').GitMode;
type GroupType = import('../src/types').GroupType;
type TaskGroup = import('../src/types').TaskGroup;
type TaskInstruction = import('../src/types').TaskInstruction;
type FoundRepo = import('../src/wire').FoundRepo;
type SuggestedGate = import('../src/wire').SuggestedGate;
type AddedRepo = import('../src/wire').AddedRepo;
type ConfigData = import('../src/wire').ConfigData;
type LibraryView = import('../src/wire').LibraryView;
type AgentView = import('../src/wire').AgentView;
type Effective = import('../src/wire').Effective;
type ReposData = import('../src/wire').ReposData;
type RepoView = import('../src/wire').RepoView;
type PickedRepos = import('../src/wire').PickedRepos;
type RepoGates = import('../src/wire').RepoGates;
type GateConfig = import('../src/wire').GateConfig;
type SettingsData = import('../src/wire').SettingsData;
type McpData = import('../src/wire').McpData;
type McpServerView = import('../src/wire').McpServerView;
type Output = import('../src/types').Output;
type Effort = import('../src/types').Effort;
type TaskScreen = import('../src/wire').TaskScreen;
type TaskComment = import('../src/wire').TaskComment;
type TaskPush = import('../src/wire').TaskPush;
type TaskResult = import('../src/wire').Result;
type TranscriptItem = import('../src/wire').TranscriptItem;
type UsageItem = import('../src/wire').UsageItem;
type StepItem = import('../src/wire').StepItem;
type FeedEvent = import('../src/wire').FeedEvent;
type PipelineEdit = import('../src/wire').PipelineEdit;
type CheckpointContext = import('../src/wire').CheckpointContext;
type ReviewItemView = import('../src/wire').ReviewItemView;

// ---------- requests ----------

type Rpc = import('../src/wire').Rpc;

/** The arguments after the method name: none when the request takes none, optional when `undefined` is allowed. */
type RpcArgs<P> = 0 extends 1 & P ? [params?: P] : [P] extends [void] ? [] : undefined extends P ? [params?: P] : [params: P];
/** What `attempt` resolves to: the result, `true` for a request without one, `undefined` on failure. */
type Attempted<R> = (R extends void ? true : R) | undefined;

// ---------- DOM ----------

/** The data-* attributes the templates set; a handler reads only the ones its own template wrote. */
type DataKey =
  | 'name' | 'id' | 'repo' | 'path' | 'i' | 'j' | 'field' | 'file' | 'preview' | 'tab' | 'url' | 'pipe' | 'tool' | 'since'
  | 'sev' | 'scenario' | 'level' | 'kind' | 'dir' | 'allow' | 'text' | 'seq' | 'runs' | 'option' | 'cmd' | 'key' | 'action'
  | 'change' | 'input' | 'href';
interface WithData {
  readonly dataset: Readonly<Record<DataKey, string>>;
}
/** An element a click handler was bound to; `disabled` is there for the buttons. */
type ActionEl = HTMLElement & WithData & { disabled?: boolean };
/** An input, textarea or select a change or input handler was bound to; `type` stays a plain string. */
type FieldEl = Omit<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement, 'type' | 'dataset'> & { type: string } & WithData;
type ActionFn = (el: ActionEl, e: Event) => unknown;
type FieldFn = (el: FieldEl, e: Event) => unknown;

// ---------- state ----------

interface Draft {
  text: string;
  no: string[];
  auto: boolean;
  key: string;
  effort: Record<string, string>;
  scenario: string;
  /** The id of the group the task goes into; empty for none. */
  group: string;
  /** The ids of the instructions the task's agents follow. */
  instructions: string[];
}

/** The group or instruction being written in the composer; without `id` it is a new one. */
interface ExtraEdit {
  kind: 'group' | 'instruction';
  id?: string;
  type: GroupType;
  label: string;
  jira: string;
  /** An instruction's text, or a group's instructions for every task in it. */
  text: string;
  /** A group's: the instructions it ticks when picked. */
  defaults: string[];
  /** A group's: the branch its tasks start from where a repo's origin has it. */
  baseBranch: string;
}

/** Small interface state that survives a reload: which groups are folded, which scenario is being edited. */
interface UiState {
  scEdit?: string | null;
  /** A new scenario not saved yet: it reaches config.yaml with its first agent. */
  scDraft?: { label: string; description: string } | null;
  extraEdit?: ExtraEdit | null;
  showAllDone?: boolean;
  /** The Tasks page lists the finished tasks too (they are always in the rail's tree). */
  showFinished?: boolean;
  /** The rail lists the tasks under the Tasks item (false: folded). */
  tasksOpen?: boolean;
  /** Sections of the rail's tree opened or folded by hand, by key; the rest are open while they hold unfinished tasks. */
  treeOpen?: Record<string, boolean>;
  /** Sections whose finished tasks are listed, not folded into one row. */
  treeDone?: Record<string, boolean>;
  /** The Integrations page lists the MCP servers you hid. */
  mcpHiddenOpen?: boolean;
  /** What the rail's tree is filtered by. */
  treeFilter?: string;
  /** The tasks with a tab over the screen, in the order they got one. */
  taskTabs?: string[];
  /** Running tasks whose tab was closed: it comes back with their next run, not while this one goes on. */
  tabsClosed?: string[];
  taskTab?: string;
  pipeEdit?: boolean;
  /** A narrow task screen: the pipeline's steps listed, not only as segments. */
  stepsOpen?: boolean;
  /** What "Fix in chat" runs Claude Code with: a model alias or id (`inherit`: the account's default), an effort or ''. */
  fixModel?: string;
  fixEffort?: string;
  [flag: string]: unknown;
}

interface AppState {
  route: Route;
  overview: Overview | null;
  draft: Draft;
  ui: UiState;
}

interface PersistedState {
  route?: Route;
  draft?: Partial<Draft>;
  ui?: UiState;
}

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): PersistedState | undefined; setState(state: PersistedState): void };

// ---------- views ----------

/** A screen. The shell calls these; each view adds its own members. */
interface View {
  enter(route: Route): unknown;
  leave?(): void;
  refresh?(): unknown;
  load?(refresh?: boolean): unknown;
  onConfig?(): void;
  onPermission?(): void;
  onPush?(msg: TaskPush): void;
  onSubmit?(e: KeyboardEvent): void;
  actions?: Record<string, ActionFn>;
  changes?: Record<string, FieldFn>;
  inputs?: Record<string, FieldFn>;
}

/** Screens by route name; each script declares its own with `interface Views { … }`. */
interface Views {
  [name: string]: View;
}

// ---------- the shell's API ----------

interface PipeStage {
  agent: string;
  output: string;
  color?: string | undefined;
  scope?: string | undefined;
  runs?: string | undefined;
  enabled?: boolean | undefined;
  model?: string | undefined;
  effort?: string | undefined;
  ownModel?: boolean | undefined;
  ownEffort?: boolean | undefined;
}

interface PipeChoice {
  name: string;
  output: string;
  enabled?: boolean | undefined;
  color?: string | undefined;
  description?: string | undefined;
}

interface PipeRowOptions {
  stages: PipeStage[];
  from?: number;
  choices?: PipeChoice[];
  empty?: string;
  runsToggle?: boolean;
  extras?: ((st: PipeStage) => string) | null;
}

/** An editor of an ordered list of agents shown as chips; each is registered under the id of its row. */
interface PipeEditor {
  names(): string[];
  from(): number;
  save(names: string[]): unknown;
  redraw?(): void;
  setRuns?(name: string, runs: string): unknown;
}

interface ScenarioInfo {
  label: string;
  icon: string;
  hint: string;
  placeholder: string;
}

interface ToastAction {
  label: string;
  run(): void;
}

interface CSApi {
  vscode: ReturnType<typeof acquireVsCodeApi>;
  /** The brand mark (an inline SVG), as the rail shows it. */
  LOGO: string;
  /** An account's key, as the start screen's tiles and the aliases know it: its email, lowercase, or `dir:<folder>`. */
  accountKey(a: { email?: string | undefined; dir: string }): string;
  call<M extends keyof Rpc>(method: M, ...params: RpcArgs<Rpc[M]['params']>): Promise<Rpc[M]['result']>;
  attempt<M extends keyof Rpc>(method: M, params?: Rpc[M]['params'], okText?: string | null): Promise<Attempted<Rpc[M]['result']>>;
  toast(text: string, kind?: string, action?: ToastAction): void;
  icon(name: string, cls?: string): string;
  esc(s: unknown): string;
  md(text: string): string;
  $<T extends HTMLElement = HTMLElement>(sel: string, root?: ParentNode): T | null;
  $$<T extends HTMLElement = HTMLElement>(sel: string, root?: ParentNode): T[];
  ago(iso: string | undefined | null): string;
  clock(t: string | number | Date): string;
  dur(ms: number): string;
  money(n: number): string;
  fmtTokens(n: number | undefined | null): string;
  resetIn(unix: number | undefined | null): string;
  meter(pct: number | undefined | null): string;
  level(pct: number | undefined | null): string;
  EFFORT_LABEL: Record<string, string>;
  effortTag(e: string | undefined | null): string;
  size(n: number): string;
  plural(n: number, one: string, many?: string): string;
  /** Warnings as one chip with their count; all of them in full on hover or focus. */
  warnTip(warnings: readonly string[] | undefined): string;
  stepName(s: { agent?: string | undefined; label?: string | undefined; repo?: string | undefined; perRepo?: boolean | undefined }): string;
  OUTPUT_INFO: Record<string, { label: string; hint: string }>;
  SCENARIO_INFO: Record<string, ScenarioInfo>;
  scInfo(id: string): ScenarioInfo & { kind: string; custom?: true };
  modelChoices(defaults: DefaultsView | null | undefined): [string, string][];
  scenarioChip(sc: string | undefined, label: string | undefined): string;
  groupChip(g: TaskGroup | undefined): string;
  sevCounts(counts: Record<string, number>): string;
  agentColor(c: string | undefined | null): string;
  S: AppState;
  views: Views;
  pipeRowHtml(id: string, opts: PipeRowOptions): string;
  libraryBlock(l: LibraryView): string;
  libraryMove(kind: 'agent' | 'scenario', id: string, libs: LibraryView[]): string;
  pipeEditors: Record<string, PipeEditor | undefined>;
  pipeDragging(): boolean;
  go(route: Route): Promise<void>;
  patch(name: string | HTMLElement, html: string): boolean;
  debounce(key: string, fn: () => unknown, ms?: number): void;
  persist(): void;
  statusBadge(st: Pick<Status, 'key' | 'tone' | 'label'>, live: Live | null | undefined): string;
  miniSteps(mini: { kind: string; agent: string | undefined; repo: string | undefined; label: string | undefined; status: string }[]): string;
  sourceChip(src: TaskSource | null | undefined): string;
  outlineHtml(items: Chip[] | null | undefined, colors?: Record<string, string | undefined>): string;
  permissionCard(p: PermissionRequest): string;
  loadOverview(): Promise<Overview>;
  autosize(ta: HTMLElement | null): void;
  shake(el: HTMLElement | null): void;
  refreshSoon(): void;
  actions: Record<string, ActionFn>;
  changes: Record<string, FieldFn>;
  inputs: Record<string, FieldFn>;
  boot(): Promise<void>;
}

/** The message each step's agent is writing (stream.ts). */
interface LiveTexts {
  /** Takes in an item pushed for a step. */
  take(key: string, item: TranscriptItem): void;
  /** Its text so far: '' before its first words, null when the page missed its start, undefined when it writes none. */
  writing(key: string): string | null | undefined;
}

/** What a transcript just loaded holds of the items pushed while it was read (stream.ts). */
interface LoadedEdge {
  /** Whether the item is in the transcript already; each item it holds is found once. */
  has(item: TranscriptItem): boolean;
}

interface Window {
  /** Set by the desktop app's page before these scripts run; VS Code and JetBrains leave it out. */
  __csHost?: 'desktop';
  escapeHtml: (s: unknown) => string;
  renderMarkdown: (text: string) => string;
  stripJsonBlock: (text: string) => string;
  liveTexts: () => LiveTexts;
  loadedEdge: (items: TranscriptItem[]) => LoadedEdge;
  CS: CSApi;
}
