// Keeping the computer awake while tasks you chose run, so agents keep working while you are away: `caffeinate` on
// macOS (built in), `systemd-inhibit` on Linux (part of systemd: Ubuntu, Debian, Fedora…). One process holds the
// computer awake for all of them, and it ends with the host's own process, so none outlives a closed window.
import type { AwakeTool } from './wire';

type AwakeToolName = NonNullable<AwakeTool['name']>;

/** How each Linux package manager installs systemd, which brings systemd-inhibit. */
const INSTALL: [manager: string, command: string][] = [
  ['apt-get', 'sudo apt-get install -y systemd'],
  ['dnf', 'sudo dnf install -y systemd'],
  ['pacman', 'sudo pacman -S --needed systemd'],
  ['zypper', 'sudo zypper install -y systemd'],
];

/** What keeps this computer awake, whether it is there, and on Linux how to install it when it is not. */
async function findAwakeTool({ platform, which }: { platform: NodeJS.Platform; which: (cmd: string) => Promise<string | null> }): Promise<AwakeTool> {
  if (platform === 'darwin') {
    const path = await which('caffeinate');
    return { name: 'caffeinate', path, install: null, about: path ? 'caffeinate, built into macOS' : 'caffeinate, built into macOS, is not on PATH (it lives in /usr/bin)' };
  }
  if (platform === 'linux') {
    const path = await which('systemd-inhibit');
    if (path) return { name: 'systemd-inhibit', path, install: null, about: 'systemd-inhibit, part of systemd' };
    let install: string | null = null;
    for (const [manager, command] of INSTALL) {
      if (await which(manager)) {
        install = command;
        break;
      }
    }
    return { name: 'systemd-inhibit', path: null, install, about: `systemd-inhibit (part of systemd) is not installed${install ? '' : '; install systemd with your package manager'}` };
  }
  return { name: null, path: null, install: null, about: 'Keeping the computer awake works on macOS (caffeinate) and Linux (systemd-inhibit)' };
}

/**
 * The tool's arguments: no idle or system sleep (the display may sleep) until `pid`, the host, ends. Closing a laptop's
 * lid still puts it to sleep.
 */
function awakeArgs(tool: AwakeToolName, pid: number): string[] {
  if (tool === 'caffeinate') return ['-i', '-m', '-s', '-w', String(pid)];
  return ['--what=idle:sleep', '--who=Claudestrator', '--why=Agents are working on a task', '--mode=block', 'tail', `--pid=${pid}`, '-f', '/dev/null'];
}

/** The process that holds the computer awake. */
interface Held {
  kill(): void;
  onExit(fn: () => void): void;
}

interface KeepAwakeDeps {
  /** Starts the tool; null where there is none. */
  start(): Held | null;
  /** Whether the task's agents work now. */
  running(taskId: string): boolean;
  now(): number;
  /** Calls `fn` after `ms`; returns what cancels it. */
  later(fn: () => void, ms: number): () => void;
}

/**
 * The tasks that keep the computer awake, each while it runs and until its time is up (`until`, ms) or with no limit
 * (null). A task waiting for you lets the computer sleep; it keeps it awake again when it runs on, while its time lasts.
 */
class KeepAwake {
  readonly #deps: KeepAwakeDeps;
  readonly #wanted = new Map<string, number | null>();
  #held: Held | null = null;
  #cancel: (() => void) | null = null;

  constructor(deps: KeepAwakeDeps) {
    this.#deps = deps;
  }

  /** `minutes`: how long at most; null: as long as the task runs. */
  want(taskId: string, minutes: number | null): void {
    this.#wanted.set(taskId, minutes === null ? null : this.#deps.now() + minutes * 60_000);
    this.sync();
  }

  drop(taskId: string): void {
    if (this.#wanted.delete(taskId)) this.sync();
  }

  /** The task's choice, while it lasts: `until` in ms, or null for no limit. */
  of(taskId: string): { until: number | null } | null {
    const until = this.#wanted.get(taskId);
    if (until === undefined || (until !== null && until <= this.#deps.now())) return null;
    return { until };
  }

  /** Whether the computer is held awake now. */
  get holding(): boolean {
    return this.#held !== null;
  }

  /** Holds the computer awake while a chosen task runs, lets it go otherwise; call it when a task starts or stops. */
  sync(): void {
    const now = this.#deps.now();
    for (const [id, until] of this.#wanted) if (until !== null && until <= now) this.#wanted.delete(id);
    const need = [...this.#wanted.keys()].some((id) => this.#deps.running(id));
    if (need && !this.#held) {
      const held = this.#deps.start();
      this.#held = held;
      held?.onExit(() => {
        if (this.#held === held) this.#held = null;
      });
    } else if (!need && this.#held) {
      const held = this.#held;
      this.#held = null;
      held.kill();
    }
    this.#cancel?.();
    this.#cancel = null;
    const ends = [...this.#wanted.values()].filter((u): u is number => u !== null);
    if (ends.length) this.#cancel = this.#deps.later(() => this.sync(), Math.min(...ends) - now);
  }

  dispose(): void {
    this.#cancel?.();
    this.#cancel = null;
    this.#wanted.clear();
    this.#held?.kill();
    this.#held = null;
  }
}

export type { Held, KeepAwakeDeps };
export { findAwakeTool, awakeArgs, KeepAwake };
