// Builds the dashboard page into the folder given (relative to the working directory): page/*.ts compiled to .js, next
// to its stylesheet and tab icon. Every host serves the page from there: the VS Code extension (vscode/dist/page),
// the JetBrains engine (sidecar/dist/engine/dist/page) and the core's own tests (core/dist/page).
//
// The page's scripts are plain browser scripts, one file each with no imports, so each is transpiled on its own;
// `npm run typecheck` checks them together (tsconfig.page.json).
//
// Usage: node <core>/scripts/build-page.mjs <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'page');
const ASSETS = ['app.css', 'tab-icon-orchestra.svg'];

const out = process.argv[2];
if (!out) {
  console.error('Usage: node build-page.mjs <out dir>');
  process.exit(1);
}
const dir = path.resolve(out);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true };
for (const name of fs.readdirSync(PAGE)) {
  if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
  const source = fs.readFileSync(path.join(PAGE, name), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions, fileName: name, reportDiagnostics: false });
  fs.writeFileSync(path.join(dir, name.replace(/\.ts$/, '.js')), outputText);
}
for (const name of ASSETS) fs.copyFileSync(path.join(PAGE, name), path.join(dir, name));
