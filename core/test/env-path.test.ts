// The PATH agents, checks and git hooks get: the user's shell's, as a terminal has it, whatever started the host.
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loginShellPath } from '../src/env';

/**
 * A `$SHELL` that behaves as zsh does with an nvm set up in ~/.zshrc: interactive (-i) it has nvm's node on PATH, as a
 * login shell only it has not. `interactive: 'fails'` is a ~/.zshrc that breaks when there is no terminal.
 */
function fakeShell(dir: string, interactive: 'nvm' | 'fails'): string {
  const file = path.join(dir, 'zsh');
  fs.writeFileSync(
    file,
    [
      '#!/bin/sh',
      'PATH="/from/zprofile:$PATH"',
      `case "$1" in *i*) ${interactive === 'nvm' ? 'PATH="/nvm/versions/node/v24/bin:$PATH"' : 'exit 1'};; esac`,
      'eval "$2"',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  return file;
}

async function withShell(interactive: 'nvm' | 'fails', fn: () => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-shell-'));
  const saved = { SHELL: process.env.SHELL, PATH: process.env.PATH };
  process.env.SHELL = fakeShell(dir, interactive);
  // What an app started from the Dock has.
  process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  try {
    await fn();
  } finally {
    process.env.SHELL = saved.SHELL;
    process.env.PATH = saved.PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('PATH: what the interactive shell adds (nvm in ~/.zshrc) comes first, then the host\'s own', { skip: process.platform === 'win32' }, async () => {
  await withShell('nvm', async () => {
    const parts = (await loginShellPath()).split(':');
    assert.equal(parts[0], '/nvm/versions/node/v24/bin', 'node as a terminal has it, ahead of any other');
    assert.ok(parts.includes('/from/zprofile'));
    assert.ok(parts.includes('/usr/bin'));
    assert.equal(new Set(parts).size, parts.length, 'each folder once');
  });
});

test('PATH: a shell that fails interactive without a terminal is asked again as a login shell', { skip: process.platform === 'win32' }, async () => {
  await withShell('fails', async () => {
    const parts = (await loginShellPath()).split(':');
    assert.equal(parts[0], '/from/zprofile');
    assert.ok(!parts.includes('/nvm/versions/node/v24/bin'));
  });
});
