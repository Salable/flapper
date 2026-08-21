/**
 * The sprite skin: pre-rendered strips, one per state, where `strips[i]`
 * animates state `i` into state `i + 1`.
 *
 * Frame 0 of a strip is its source state at rest and the last frame is its
 * destination at rest, and the build step (tools/build_assets.py) guarantees
 * the last frame of `strips[i]` is byte-identical to frame 0 of
 * `strips[i + 1]`, so a tile coming to rest never shifts a pixel:
 *
 *   at rest on state i  -> strips[i], frame 0
 *   flipping i -> i + 1 -> strips[i], frames 1..n-1
 */
export class SpriteSkin {
  /**
   * @param {object} manifest parsed assets/manifest.json
   * @param {ImageBitmap[]} strips one per cycle position, index-aligned with manifest.cycle
   */
  constructor(manifest, strips) {
    this.cycle = manifest.cycle;
    this.tileSize = manifest.tileSize;
    this.frames = manifest.framesPerStrip;
    this.strips = strips;
  }

  /** Which frame of the strip shows `progress` of a flap; 0 is at rest. */
  frameFor(progress) {
    if (!(progress > 0)) return 0;
    return 1 + Math.floor(Math.min(0.999999, progress) * (this.frames - 1));
  }

  drawTile(ctx, state, progress, x, y, size) {
    const src = this.tileSize;
    ctx.drawImage(this.strips[state], 0, this.frameFor(progress) * src, src, src, x, y, size, size);
  }
}
