#!/usr/bin/env node
/**
 * Export a board to video, with no browser and no display running.
 *
 * Every frame is asked for rather than captured: the board's `tick(now)`
 * takes its timestamp as an argument, and the animations are pure functions
 * of the frame number (lib/board/animations.mjs), so a whole export is
 * deterministic, identical every run, and as fast as the machine can draw
 * rather than as slow as the wall clock.
 *
 *   node tools/export-video.mjs --animation explosion --out explosion.mp4
 *   node tools/export-video.mjs --text "HELLO WORLD" --out hello.mp4
 *
 *   --cols 20 --rows 11     the grid (default 20 x 11)
 *   --tile 48               rendered card size
 *   --fps 30
 *   --seconds 6             for a looping animation, which has no length
 *   --frames-only <dir>     write PNGs and stop, for when ffmpeg is absent
 *
 * Local-only, deliberately: ffmpeg is not on the serverless host, so a
 * "download this board as a video" button is a hosting decision rather than
 * a code one. This is the part that does not need that decision made.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { offlineBoard, framesFor } from '../lib/board/offline.mjs';
import { animation, ANIMATION_IDS } from '../lib/board/animations.mjs';
import { resolveBoardTheme } from '../lib/board/board-theme.mjs';
import { layout, charsetFromManifest } from '../lib/board/layout.mjs';
import { RING } from '../lib/board/ring.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
};

const animationName = flag('animation', null);
const text = flag('text', null);
const out = flag('out', null);
const framesOnly = flag('frames-only', null);
const cols = Number(flag('cols', 20));
const rows = Number(flag('rows', 11));
const tilePx = Number(flag('tile', 48));
const fps = Number(flag('fps', 30));
const seconds = Number(flag('seconds', 6));

if (!animationName && text === null) {
  console.error('export-video: give it --animation <name> or --text "WORDS"');
  console.error(`  animations: ${ANIMATION_IDS.join(', ')}`);
  process.exit(1);
}
if (animationName && !animation(animationName)) {
  console.error(`export-video: no animation called "${animationName}" - have ${ANIMATION_IDS.join(', ')}`);
  process.exit(1);
}
if (!out && !framesOnly) {
  console.error('export-video: give it --out <file.mp4>, or --frames-only <dir>');
  process.exit(1);
}

const { pack } = resolveBoardTheme({}, {});
const render = offlineBoard({ createCanvas, pack, cols, rows, tilePx, fps });

/** Every frame this export is made of, as PNG buffers. */
function frames() {
  const shots = [];
  if (animationName) {
    const spec = animation(animationName);
    const count = framesFor(animationName, cols, rows, { fps, loopSeconds: seconds });
    for (let frame = 0; frame < count; frame += 1) {
      shots.push(render.setAnimationFrame(spec, frame).toBuffer('image/png'));
    }
    return shots;
  }
  // Text: put the page up, then render the flip itself settling.
  const charset = charsetFromManifest({ cycle: RING });
  const { pages } = layout(text, { cols, rows, charset });
  render.setPage(pages[0] ?? Array.from({ length: rows }, () => ' '.repeat(cols)));
  const count = Math.max(1, Math.round(seconds * fps));
  for (let frame = 0; frame < count; frame += 1) shots.push(render.step().toBuffer('image/png'));
  return shots;
}

const shots = frames();
console.log(`export-video: ${shots.length} frames at ${cols}x${rows}, ${tilePx}px cards, ${fps}fps`);

const dir = framesOnly ?? join(tmpdir(), `flapper-export-${process.pid}`);
await mkdir(dir, { recursive: true });
await Promise.all(shots.map((png, n) => writeFile(join(dir, `${String(n).padStart(5, '0')}.png`), png)));

if (framesOnly) {
  console.log(`export-video: frames written to ${dir}`);
  process.exit(0);
}

// -loop 0 on the source, not the output: a finite animation is exported as
// the one run it is, and the player decides whether to repeat it.
const ff = spawn(
  'ffmpeg',
  [
    '-y',
    '-framerate', String(fps),
    '-i', join(dir, '%05d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    // Even dimensions, which h.264 requires and a card grid rarely gives.
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    out,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
let stderr = '';
ff.stderr.on('data', (chunk) => {
  stderr += chunk;
});
const code = await new Promise((resolve) => ff.on('close', resolve));
await rm(dir, { recursive: true, force: true });

if (code !== 0) {
  console.error(stderr.split('\n').slice(-8).join('\n'));
  console.error(`export-video: ffmpeg exited ${code}`);
  process.exit(1);
}
console.log(`export-video: wrote ${out}`);
