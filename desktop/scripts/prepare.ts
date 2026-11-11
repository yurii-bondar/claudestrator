// Builds what the app bundle copies in besides its own entry points (electrobun.config.ts, `copy`), into .gen/:
// - .gen/engine/worker.js: the engine's thread, bundled with `vscode` aliased to core/src/vscode-shim.ts, as the
//   JetBrains sidecar's build does, and next to it the sandbox runtime the engine starts as a process of its own;
// - .gen/page: the dashboard page (core/scripts/build-page.mjs), as every host serves it.
// Needs `npm ci` in core/ (the page's TypeScript, `yaml`, the sandbox runtime).
//
// Usage: bun scripts/prepare.ts
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const here = resolve(import.meta.dir, '..');
const core = resolve(here, '../core');
const out = join(here, '.gen');
const SANDBOX = '@anthropic-ai/sandbox-runtime';

if (!existsSync(join(core, 'node_modules'))) {
  console.error(`Missing ${core}/node_modules. Run \`npm ci\` in core/ first.`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const started = performance.now();
const built = await Bun.build({
  entrypoints: [join(here, 'src/engine/worker.ts')],
  outdir: join(out, 'engine'),
  target: 'bun',
  format: 'esm',
  // Smaller to read at start; names kept, so the log's stack traces stay readable.
  minify: { whitespace: true, syntax: true, identifiers: false },
  sourcemap: 'linked',
  // Started as a process (`bun <cli.js>`), never imported: it ships as files, below.
  external: [SANDBOX],
  plugins: [
    {
      name: 'vscode-shim',
      setup(build) {
        build.onResolve({ filter: /^vscode$/ }, () => ({ path: join(core, 'src/vscode-shim.ts') }));
      },
    },
  ],
});
if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}
const [worker] = built.outputs;
console.log(`engine: ${worker ? `${(worker.size / 1024).toFixed(0)} KB` : '?'} in ${Math.round(performance.now() - started)} ms`);

// The sandbox runtime and what it needs, as installed in the core: no Windows helper (no sandbox there), and none of
// the sources, browser builds, types and docs that come with the packages (as jetbrains/sidecar/build.mjs ships it).
const SKIP = /[\\/](vendor[\\/]srt-win|zod[\\/]src|node-forge[\\/](dist|flash))($|[\\/])|\.map$|\.d\.c?ts$|README\.md$/;
const shipped = new Set<string>();
function ship(name: string): void {
  if (shipped.has(name)) return;
  shipped.add(name);
  const from = join(core, 'node_modules', name);
  cpSync(from, join(out, 'engine', 'node_modules', name), { recursive: true, filter: (src) => !SKIP.test(src) });
  const manifest = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  for (const dep of Object.keys(manifest.dependencies || {})) ship(dep);
}
ship(SANDBOX);

// The page's scripts, stylesheet and tab icon.
const page = Bun.spawnSync([process.execPath, join(core, 'scripts', 'build-page.mjs'), join(out, 'page')], { stdout: 'inherit', stderr: 'inherit' });
if (page.exitCode !== 0) process.exit(page.exitCode ?? 1);
console.log(`prepared ${out}`);
