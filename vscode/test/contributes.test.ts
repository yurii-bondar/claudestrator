// What the extension's package.json contributes, as VS Code reads it.
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

// Runs from dist/vscode/test: the extension folder is three up.
test('settings: a workspace cannot point the Atlassian token or the Claude Code CLI somewhere else', async () => {
  // A cloned repo's .vscode/settings.json could otherwise send the API token to its own host, or run its own binary.
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { scope?: string }> } } };
  const props = pkg.contributes.configuration.properties;
  for (const key of ['claudestrator.claudePath', 'claudestrator.claudeConfigDir', 'claudestrator.atlassian.site', 'claudestrator.atlassian.email']) assert.equal(props[key]!.scope, 'machine', key);
});

test('menus: Open in Tab is a command of its own, right after Open Task in the sidebar\'s menu and in the dashboard\'s, and not in the palette', async () => {
  interface Item { command: string; when?: string; group?: string }
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
    contributes: { commands: { command: string; title: string }[]; menus: Record<string, Item[]> };
    activationEvents?: string[];
  };
  const { commands, menus } = pkg.contributes;
  assert.equal(commands.find((c) => c.command === 'claudestrator.openTaskInTab')?.title, 'Open in Tab');
  for (const [menu, when] of [['view/item/context', 'view == claudestrator.tasks && viewItem =~ /^task/'], ['webview/context', "webviewId == 'claudestrator.dashboard' && webviewSection == 'task'"]] as const) {
    const items = menus[menu]!.filter((i) => i.group && i.group.startsWith('1_task@'));
    const order = items.sort((a, b) => Number(a.group!.split('@')[1]) - Number(b.group!.split('@')[1])).map((i) => i.command);
    assert.deepEqual(order.slice(0, 2), ['claudestrator.openTask', 'claudestrator.openTaskInTab'], menu);
    assert.equal(new Set(items.map((i) => i.group)).size, items.length, `${menu}: each item its own place`);
    assert.equal(menus[menu]!.find((i) => i.command === 'claudestrator.openTaskInTab')!.when, when, `${menu}: on every task`);
  }
  assert.equal(menus.commandPalette!.find((i) => i.command === 'claudestrator.openTaskInTab')?.when, 'false', 'it needs a task to open');
});
