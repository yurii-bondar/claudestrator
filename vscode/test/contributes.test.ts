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
