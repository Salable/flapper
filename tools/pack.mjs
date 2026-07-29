#!/usr/bin/env node
/**
 * Package Flapper into a distributable macOS .app bundle, then ad-hoc sign it
 * and zip it with `ditto`.
 *
 * Two details matter for handing the result to someone else:
 *
 * - The bundle is built `universal`, so it runs on both Apple Silicon and Intel
 *   Macs. Pass `--arch=arm64` (or `x64`) for a build roughly half the size when
 *   you know which machine it's going to.
 * - The .zip is produced with `ditto`, not `zip`. An Electron bundle contains
 *   symlinks inside Electron Framework.framework, and `zip -r` dereferences
 *   them, which both bloats the archive and breaks the app's code signature.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const archArg = process.argv.find((a) => a.startsWith('--arch='));
const arch = archArg ? archArg.slice('--arch='.length) : 'universal';

// Whitelist: the app has no runtime dependencies, so only these need to ship.
// Everything else — the 155MB folder of source GIFs above all — stays out.
const KEEP = /^\/(package\.json|LICENSE|docs($|\/)|src($|\/)|assets($|\/))/;

const icon = path.join(ROOT, 'build', 'icon.icns');
if (!fs.existsSync(icon)) {
  console.error('build/icon.icns is missing. Run: python3 tools/build_icon.py');
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, 'assets', 'manifest.json'))) {
  console.error('assets/manifest.json is missing. Run: npm run build:assets');
  process.exit(1);
}

console.log(`packaging Flapper ${pkg.version} for darwin/${arch}`);

const [appPath] = await packager({
  dir: ROOT,
  out: OUT,
  overwrite: true,
  platform: 'darwin',
  arch,
  name: 'Flapper',
  appVersion: pkg.version,
  appBundleId: 'app.salable.flapper',
  appCategoryType: 'public.app-category.graphics-design',
  icon,
  prune: true,
  ignore: (relative) => relative !== '' && !KEEP.test(relative),
  // Signed below instead. Left to itself, @electron/osx-sign hunts the keychain
  // for a Developer ID and fails the build if it finds one it can't use.
  osxSign: false,
});

const app = path.join(appPath, 'Flapper.app');
console.log(`\nbuilt ${app}`);

// Ad-hoc signature: enough to launch on Apple Silicon, which refuses unsigned
// binaries outright. Not enough to satisfy Gatekeeper on a machine that
// downloaded the app — see the README for what the recipient has to do.
console.log('ad-hoc signing');
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
// codesign reports to stderr, so spawnSync rather than execFileSync.
const signature = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' }).stderr;
console.log(
  signature
    .trim()
    .split('\n')
    .filter((line) => /^(Signature|Identifier|TeamIdentifier|Format)/.test(line))
    .join('\n'),
);

const zip = path.join(OUT, `Flapper-${pkg.version}-${arch}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);

const mb = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(1);
console.log(`\nzipped ${zip} (${mb(zip)} MB)`);
