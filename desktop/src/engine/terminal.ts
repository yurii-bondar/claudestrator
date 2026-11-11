// Terminals the engine opens: the Claude and MCP sign-ins, "Continue in terminal", "Fix in chat". Each runs one
// interactive program (it may ask for a code, or be a whole Claude session), so it gets a real terminal: the system's,
// started on a small script that runs the program and writes its exit code where the engine looks for it.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { shq } from '../../../core/src/sandbox';

export interface TerminalSpec {
  name: string;
  cwd: string;
  /** `null` unsets the variable. */
  env: Record<string, string | null>;
  /** The program and its arguments; null: a shell, in `cwd`. */
  command: string[] | null;
}

/**
 * The script a terminal runs: in `cwd`, with `env`, the program, then its exit code into `statusFile`. A terminal
 * closed while the program runs ends it with a signal, which is reported too.
 */
export function terminalScript(spec: TerminalSpec, files: { statusFile: string; pidFile: string }): string {
  const vars = Object.entries(spec.env).map(([k, v]) => (v === null ? `unset ${k}` : `export ${k}=${shq(v)}`));
  const run = spec.command ? spec.command.map(shq).join(' ') : `exec "\${SHELL:-/bin/sh}" -l`;
  return [
    '#!/bin/sh',
    `printf '\\033]0;%s\\007' ${shq(spec.name)}`,
    `echo $$ > ${shq(files.pidFile)}`,
    `done_() { echo "$1" > ${shq(`${files.statusFile}.tmp`)} && mv ${shq(`${files.statusFile}.tmp`)} ${shq(files.statusFile)}; exit "$1"; }`,
    "trap 'done_ 129' HUP INT TERM",
    `cd ${shq(spec.cwd)} || done_ 1`,
    ...vars,
    run,
    'done_ $?',
    '',
  ].join('\n');
}

/** How a script file is opened in the system's terminal; null where there is none we know. */
function opener(script: string): string[] | null {
  if (process.platform === 'darwin') return ['open', script]; // `.command` files open in the user's terminal app
  if (process.platform === 'linux') return ['x-terminal-emulator', '-e', 'sh', script];
  return null;
}

/** How often an open terminal's status file is looked for: as often as VS Code's host checks a terminal's exit. */
const POLL_MS = 1000;

export interface Terminals {
  open(id: number, spec: TerminalSpec): Promise<void>;
  /** Ends the program in it; its terminal window stays, as the user's. */
  close(id: number): Promise<void>;
  closeAll(): Promise<void>;
}

/** `onExit(id, code)` when a terminal's program ends, or its terminal is closed (code 129). */
export function createTerminals({ dir, onExit }: { dir: string; onExit: (id: number, code: number | undefined) => void }): Terminals {
  const open = new Map<number, { timer: ReturnType<typeof setInterval>; files: { statusFile: string; pidFile: string } }>();
  const filesOf = (id: number) => ({ script: path.join(dir, `${id}.command`), statusFile: path.join(dir, `${id}.status`), pidFile: path.join(dir, `${id}.pid`) });
  // Scripts of an earlier run are no use: the engine that waited for them is gone.
  const ready = fs.rm(dir, { recursive: true, force: true }).then(() => fs.mkdir(dir, { recursive: true, mode: 0o700 }));

  const finish = async (id: number, code: number | undefined): Promise<void> => {
    const t = open.get(id);
    if (!t) return;
    clearInterval(t.timer);
    open.delete(id);
    const f = filesOf(id);
    await Promise.all([f.script, f.statusFile, f.pidFile].map((p) => fs.rm(p, { force: true })));
    onExit(id, code);
  };

  const close = async (id: number): Promise<void> => {
    const t = open.get(id);
    if (!t) return;
    const pid = Number.parseInt(await fs.readFile(t.files.pidFile, 'utf8').catch(() => ''), 10);
    // The program is the script's child; the script then reports the signal.
    if (pid > 0) spawn('pkill', ['-TERM', '-P', String(pid)], { stdio: 'ignore' }).on('error', () => undefined);
    await finish(id, undefined);
  };

  return {
    async open(id, spec) {
      await ready;
      const f = filesOf(id);
      const cmd = opener(f.script);
      if (!cmd) throw new Error(`Claudestrator cannot open a terminal on ${process.platform} yet; run it yourself: ${(spec.command || []).join(' ')}`);
      await fs.writeFile(f.script, terminalScript({ ...spec, cwd: spec.cwd || os.homedir() }, f), { mode: 0o700 });
      const timer = setInterval(() => {
        fs.readFile(f.statusFile, 'utf8').then((s) => {
          const code = Number.parseInt(s.trim(), 10);
          return finish(id, Number.isNaN(code) ? undefined : code);
        }, () => undefined);
      }, POLL_MS);
      open.set(id, { timer, files: f });
      await new Promise<void>((resolve, reject) => {
        const child = spawn(cmd[0]!, cmd.slice(1), { stdio: 'ignore', detached: true });
        child.on('error', reject);
        child.on('spawn', () => {
          child.unref();
          resolve();
        });
      }).catch(async (e: Error) => {
        await finish(id, undefined);
        throw e;
      });
    },
    close,
    async closeAll() {
      await Promise.all([...open.keys()].map(close));
    },
  };
}
