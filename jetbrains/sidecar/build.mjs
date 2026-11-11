// Bundles the Claudestrator engine (core/src, driven by vscode/src/orchestrator.ts and panel.ts) and the stdio bridge
// into dist/engine/, next to the dashboard page (core/page, built into dist/page as every host serves it).
// `vscode` is replaced by src/vscode-shim.ts, which hands what the engine asks of an editor to the IDE.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, '../../core');
const out = resolve(here, 'dist/engine');

if (!existsSync(join(core, 'node_modules'))) {
  console.error(`Missing ${core}/node_modules. Run \`npm ci\` in core/ first.`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dist'), { recursive: true });

const SANDBOX = '@anthropic-ai/sandbox-runtime';
const common = { bundle: true, platform: 'node', target: 'node18', format: 'cjs', sourcemap: false, legalComments: 'none', logLevel: 'info' };

await build({
  ...common,
  entryPoints: [join(here, 'src/main.ts')],
  outfile: join(out, 'dist/sidecar.js'),
  alias: { vscode: join(here, 'src/vscode-shim.ts') },
  // `yaml` is bundled from the core's node_modules. The sandbox runtime is not: the engine starts its CLI as a
  // process of its own (checks and git hooks run in it), so it ships as files, below.
  nodePaths: [join(core, 'node_modules')],
  external: [SANDBOX],
});

// The sandbox runtime and what it needs, as installed in the core: no Windows helper (no sandbox there), and none
// of the sources, browser builds, types and docs that come with the packages.
const SKIP = /[\\/](vendor[\\/]srt-win|zod[\\/]src|node-forge[\\/](dist|flash))($|[\\/])|\.map$|\.d\.c?ts$|README\.md$/;
const shipped = new Set();
const ship = (name) => {
  if (shipped.has(name)) return;
  shipped.add(name);
  const from = join(core, 'node_modules', name);
  cpSync(from, join(out, 'node_modules', name), { recursive: true, filter: (src) => !SKIP.test(src) });
  for (const dep of Object.keys(JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).dependencies || {})) ship(dep);
};
ship(SANDBOX);

// The page: its scripts, stylesheet and tab icon, as the VS Code extension serves them.
execFileSync(process.execPath, [join(core, 'scripts', 'build-page.mjs'), join(out, 'dist', 'page')], { stdio: 'inherit' });
