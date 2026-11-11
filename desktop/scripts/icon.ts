// Renders the app icon (assets/icon.svg) into assets/icon.iconset, the PNG sizes macOS wants, which the build turns
// into the bundle's .icns (electrobun.config.ts, `mac.icons`). Run it after changing the SVG; macOS only: it renders
// with Quick Look (qlmanage) and scales with sips.
//
// Usage: bun scripts/icon.ts
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = resolve(import.meta.dir, '..');
const svg = join(here, 'assets', 'icon.svg');
const out = join(here, 'assets', 'icon.iconset');

const run = (cmd: string[]): void => {
  const r = Bun.spawnSync(cmd, { stdout: 'ignore', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} failed: ${r.stderr.toString().trim()}`);
};

const tmp = mkdtempSync(join(tmpdir(), 'cs-icon-'));
try {
  run(['qlmanage', '-t', '-s', '1024', '-o', tmp, svg]);
  const master = join(tmp, 'icon.svg.png');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // iconutil's names: icon_<size>x<size>[@2x].png, each @2x twice the pixels of its size.
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = size * scale;
      const file = join(out, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
      run(['sips', '-z', String(px), String(px), master, '--out', file]);
    }
  }
  renameSync(master, join(here, 'assets', 'icon.png'));
  console.log(`rendered ${out} and assets/icon.png`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
