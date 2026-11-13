// Keeping the computer awake while chosen tasks run: the tool each system has, and one process held while it is needed.
import test from 'node:test';
import * as assert from 'node:assert/strict';

import { findAwakeTool, awakeArgs, KeepAwake } from '../src/awake';

/** A PATH with these commands on it. */
const has = (...cmds: string[]) => async (cmd: string) => (cmds.includes(cmd) ? `/usr/bin/${cmd}` : null);

test('awake: macOS has caffeinate built in; Linux systemd-inhibit, with how to install it; Windows neither', async () => {
  assert.deepEqual(await findAwakeTool({ platform: 'darwin', which: has('caffeinate') }), { name: 'caffeinate', path: '/usr/bin/caffeinate', install: null, about: 'caffeinate, built into macOS' });
  assert.equal((await findAwakeTool({ platform: 'darwin', which: has() })).path, null);

  assert.deepEqual(await findAwakeTool({ platform: 'linux', which: has('systemd-inhibit', 'apt-get') }), { name: 'systemd-inhibit', path: '/usr/bin/systemd-inhibit', install: null, about: 'systemd-inhibit, part of systemd' });
  const ubuntu = await findAwakeTool({ platform: 'linux', which: has('apt-get') });
  assert.equal(ubuntu.path, null);
  assert.equal(ubuntu.install, 'sudo apt-get install -y systemd', 'Ubuntu and Debian install it with apt');
  assert.equal((await findAwakeTool({ platform: 'linux', which: has('dnf') })).install, 'sudo dnf install -y systemd');
  const unknown = await findAwakeTool({ platform: 'linux', which: has() });
  assert.equal(unknown.install, null);
  assert.match(unknown.about, /install systemd with your package manager/);

  const windows = await findAwakeTool({ platform: 'win32', which: has('caffeinate') });
  assert.equal(windows.name, null);
  assert.match(windows.about, /macOS \(caffeinate\) and Linux \(systemd-inhibit\)/);
});

test('awake: the tool holds off sleep, not the display, and ends with the host process', () => {
  assert.deepEqual(awakeArgs('caffeinate', 42), ['-i', '-m', '-s', '-w', '42']);
  const linux = awakeArgs('systemd-inhibit', 42);
  assert.ok(linux.includes('--what=idle:sleep'));
  assert.deepEqual(linux.slice(-4), ['tail', '--pid=42', '-f', '/dev/null'], 'what it runs ends when the host does');
});

/** A KeepAwake on a clock of its own, with the processes it starts and the tasks that run. */
function keeper({ tool = true } = {}) {
  let now = 1_000_000;
  const running = new Set<string>();
  const started: { killed: boolean; exit: () => void }[] = [];
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const k = new KeepAwake({
    start: () => {
      if (!tool) return null;
      let exit = () => {};
      const held = {
        killed: false,
        exit: () => {
          held.killed = true;
          exit();
        },
      };
      started.push(held);
      return { kill: () => void (held.killed = true), onExit: (fn) => void (exit = fn) };
    },
    running: (id) => running.has(id),
    now: () => now,
    later: (fn, ms) => {
      const t = { at: now + ms, fn, cancelled: false };
      timers.push(t);
      return () => void (t.cancelled = true);
    },
  });
  /** Moves the clock on, firing what was due. */
  const pass = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => !x.cancelled && x.at <= now)) {
      t.cancelled = true;
      t.fn();
    }
  };
  const alive = () => started.filter((h) => !h.killed).length;
  return { k, running, started, alive, pass };
}

test('awake: one process while a chosen task runs; a task waiting for you lets the computer sleep', () => {
  const { k, running, started, alive } = keeper();
  running.add('A');
  k.want('A', null);
  assert.equal(alive(), 1);
  assert.ok(k.holding);

  running.add('B');
  k.want('B', null);
  assert.equal(started.length, 1, 'one process for every task');

  running.delete('A');
  k.sync();
  assert.equal(alive(), 1, 'B still runs');
  running.delete('B');
  k.sync();
  assert.equal(alive(), 0, 'nothing runs: the computer may sleep');
  assert.deepEqual(k.of('B'), { until: null }, 'the choice stays for when it runs on');

  running.add('B');
  k.sync();
  assert.equal(alive(), 1, 'it runs on after you answered: awake again');
  k.drop('B');
  assert.equal(alive(), 0);
  assert.equal(k.of('B'), null);
});

test('awake: at most the hours you chose, then the computer may sleep while the task still runs', () => {
  const { k, running, alive, pass } = keeper();
  running.add('A');
  k.want('A', 60);
  assert.deepEqual(k.of('A'), { until: 1_000_000 + 3_600_000 });
  pass(59 * 60_000);
  assert.equal(alive(), 1);
  pass(60_000);
  assert.equal(alive(), 0, 'its hour is up');
  assert.equal(k.of('A'), null);

  k.want('A', 30);
  assert.equal(alive(), 1, 'chosen again');
  k.want('A', null);
  pass(10 * 60 * 60_000);
  assert.equal(alive(), 1, 'no limit now');
});

test('awake: a tool that ended on its own is started again; none at all holds nothing; dispose lets go', () => {
  const { k, running, started, alive } = keeper();
  running.add('A');
  k.want('A', null);
  started[0]!.exit();
  assert.equal(k.holding, false);
  k.sync();
  assert.equal(started.length, 2);
  k.dispose();
  assert.equal(alive(), 0);
  assert.equal(k.of('A'), null);

  const none = keeper({ tool: false });
  none.running.add('A');
  none.k.want('A', null);
  assert.equal(none.k.holding, false, 'Windows, or the tool missing: the choice holds nothing');
});
