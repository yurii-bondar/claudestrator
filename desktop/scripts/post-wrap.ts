// Runs after Electrobun wraps the app, before the .dmg is made (electrobun.config.ts, `scripts.postWrap`), on macOS:
// - the version Finder's Get Info and the About window show (CFBundleShortVersionString, which the wrapper leaves out);
// - without a Developer ID (no ELECTROBUN_DEVELOPER_ID), an ad-hoc signature over the whole bundle. Only the wrapper's
//   binary comes signed (by the linker), so `codesign --verify` finds resources no signature covers, and a copy that
//   came from the web counts as damaged. Sealed ad hoc, it runs on this Mac and opens elsewhere once allowed
//   (README.md, "Installing"). With a Developer ID, Electrobun signs (and notarizes) the bundle itself; nothing here
//   touches it then, as a change after its signature would break it.
const app = process.env['ELECTROBUN_WRAPPER_BUNDLE_PATH'];
const version = process.env['ELECTROBUN_APP_VERSION'];

function run(cmd: string[]): void {
  const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed: ${r.stderr.toString().trim()}`);
}

if (process.platform === 'darwin' && app && !process.env['ELECTROBUN_DEVELOPER_ID']) {
  const plist = `${app}/Contents/Info.plist`;
  if (version) {
    const has = Bun.spawnSync(['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleShortVersionString', plist]).exitCode === 0;
    run(['/usr/libexec/PlistBuddy', '-c', `${has ? 'Set' : 'Add'} :CFBundleShortVersionString ${has ? '' : 'string '}${version}`, plist]);
  }
  run(['codesign', '--force', '--deep', '--sign', '-', app]);
  run(['codesign', '--verify', '--deep', '--strict', app]);
  console.log(`post-wrap: ${app} is version ${version ?? '?'}, signed ad hoc`);
}
