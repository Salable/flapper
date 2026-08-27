'use client';

/**
 * A board drawn from a pack, for judging it: the real engine, the real
 * skin, re-skinned whenever the pack changes. Debounced, because the editor
 * changes it on every keystroke of a colour; fonts and art are cached by
 * the loader, so a rebuild is the cards and nothing else.
 */

import { useEffect, useRef, useState } from 'react';
import { Flipboard } from '@/lib/board/flipboard.js';
import { PACK_DEFAULTS } from '@/lib/board/theme-pack.mjs';
import { loadProcedural } from '@/components/flapper/assets';
import { createAmbient } from '@/components/flapper/ambient';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';
import { Button } from '@/components/ui/Button';

/** Frames to keep re-measuring for while the page settles - about a second. */
const SETTLE_FRAMES = 60;

const DEBOUNCE_MS = 120;

export function ThemePreview({
  pack,
  text,
  cols = 14,
  rows = 3,
  tilePx = 56,
  onText,
  bar = true,
  fixed = false,
  loop = 0,
  ambientMs = 0,
  screenAspect,
  align,
  valign,
  wrap,
}: {
  pack: ThemePack;
  /**
   * One message, or several to alternate between. Several is how the uneven
   * travel becomes visible: a tile only moves forward round the ring, so going
   * from A to B is one step and from Z to A is thirty-odd. Flipping the same
   * text again sends every tile the same distance every time and shows none of
   * that; flipping to a *different* message does.
   */
  text: string | readonly string[];
  cols?: number;
  rows?: number;
  tilePx?: number;
  /**
   * Given, the board becomes the typing panel: click it and type, and what
   * you type is what the glass shows. Judging a design against a fixed
   * pangram tells you very little about whether your own words fit.
   */
  onText?: (text: string) => void;
  /**
   * Off for a board used as a picture - the posters on /new are twelve boards
   * on one page and twelve Flip buttons would be noise. They still flip once
   * on arrival, which is the point of them being real.
   */
  bar?: boolean;
  /**
   * Fixed sizing rather than fluid.
   *
   * Fluid is right where the board should follow its column: `width: 100%` up
   * to a cap, measured back by a ResizeObserver. But a row of posters that all
   * ask for the same size must *get* the same size, and measurement is a race -
   * one card in a rail came out 205px wide where its neighbours were 212, for
   * no reason anybody could see except that it was measured a moment earlier.
   * Given an exact tile size there is nothing to measure, so don't.
   */
  fixed?: boolean;
  /**
   * Advance to the next message every `loop` ms, for a board being used to
   * demonstrate a behaviour rather than a design. 0 is off, which is what
   * everything else wants.
   */
  loop?: number;
  /**
   * The board's own Fidget setting, so what a sign is actually doing on the
   * glass - twitching a tile now and then, sweeping about once in twelve -
   * is also what this preview shows rather than something perfectly still
   * that the real display never is. 0 (the default) is off, same as
   * everywhere else Fidget is off unless a board asks for it.
   */
  ambientMs?: number;
  /**
   * The screen a board's grid was fit to (its own `screen.w / screen.h`),
   * for framing the box against that instead of `cols / rows` directly.
   * The two are close but not equal - integer rounding of a small grid
   * (e.g. Huge cards: 8 cols) can drift noticeably from the true ratio,
   * which otherwise showed up as the box visibly changing shape when only
   * card size changed and the declared screen had not. Letterboxed to the
   * true ratio instead, so every card size for one screen reads as the
   * same screen. Omitted, the box is `cols / rows` as before - right for a
   * preview with no screen of its own to be true to (Designs, /new).
   */
  screenAspect?: number;
  /**
   * How `text` lays out, passed straight through to `Flipboard.setText`'s
   * own overrides (`lib/board/layout.mjs`'s `align`/`valign`/`wrap`) -
   * omitted, the layout engine's own defaults apply (center/middle/word),
   * same as before this prop existed.
   */
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  wrap?: 'word' | 'char' | 'none';
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<any>(null);
  const ambientRef = useRef<ReturnType<typeof createAmbient> | null>(null);
  const [error, setError] = useState('');
  /*
   * Whether the board exists yet, so the size effect below can wait for it.
   *
   * A ResizeObserver calls back the moment it starts observing - and this
   * board is built late, behind a debounce and an async skin load, so that
   * first call landed on a null ref and did nothing. The box does not change
   * afterwards (the preview column is a fixed width), so the observer never
   * fired again and the board kept the size it measured before the canvas's
   * aspect-ratio had resolved: a 494x182 buffer stretched into a 487x270 box,
   * which drew square cards half again as tall as they were wide.
   */
  const [ready, setReady] = useState(false);
  const [replays, setReplays] = useState(0);
  const messages = Array.isArray(text) ? text : [text];
  const showing = messages[replays % messages.length] ?? '';
  // What to paint the moment the board exists. Held in a ref so the effect that
  // builds the board does not depend on the text: a message change should flip
  // the tiles, not rebuild a skin and its forty-two cards.
  const firstText = useRef(showing);
  firstText.current = showing;

  /*
   * The shape of the board, which is the shape of the box.
   *
   * Cards are square, so a board of cols x rows is exactly that ratio and the
   * box can simply be told it - no tile size involved. It used to be worked
   * out from a `tilePx` each caller passed (56 here, 30 there, 26, 9), which
   * was four magic numbers deciding a shape that the grid already knows, and
   * meant the box and the cards could disagree about what square meant.
   *
   * A fixed board still wants real pixels, so tilePx stays for that - it is a
   * size then, not a shape.
   */
  const gap = Math.round(tilePx * 0.035);
  const width = cols * tilePx + (cols - 1) * gap + 12;
  const height = rows * tilePx + (rows - 1) * gap + 12;

  /*
   * Only the keys actually given - `layout()` (`lib/board/layout.mjs`)
   * spreads its defaults under `options`, and an explicit `align:
   * undefined` in that spread overrides the default to undefined rather
   * than leaving it alone (`{...{align:'center'}, ...{align: undefined}}`
   * is `{align: undefined}`, not `{align:'center'}`). `alignLine`'s own
   * fallback for anything that isn't 'right'/'center' reads as 'left', so
   * every caller that doesn't pass these - which is everywhere but the
   * one panel that will - would have silently gone left/top/word instead
   * of the engine's real center/middle/word default.
   */
  const layoutOverrides: { align?: string; valign?: string; wrap?: string } = {
    ...(align !== undefined ? { align } : {}),
    ...(valign !== undefined ? { valign } : {}),
    ...(wrap !== undefined ? { wrap } : {}),
  };

  /*
   * A fixed board already knows its own exact pixel box (`width`/`height`
   * above) - no ResizeObserver, no settling, given rather than measured.
   * Letterboxing it is the same arithmetic then, just done once up front
   * instead of left to `aspect-ratio` + `place-items: center` (the fluid
   * frame below): the frame is `width x height`'s own bounding box at
   * `screenAspect`, canvas centered inside untouched.
   */
  const frameSize =
    fixed && screenAspect !== undefined
      ? width / height > screenAspect
        ? { width, height: width / screenAspect }
        : { height, width: height * screenAspect }
      : null;

  // Build (or re-skin) after the pack has been still for a moment.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      loadProcedural(pack)
        .then((skin) => {
          if (cancelled) return;
          /*
           * The flip's mechanical feel comes from the pack too - Scroll
           * speed, Landing, Sweep, Sweep shape, Always flip - so a design
           * being edited previews how it moves, not just what colour it is.
           * `dwellMs` is not here: that is a queue's pacing between
           * messages, and this preview has no queue, just a demo replay.
           *
           * Merged against the pack's own defaults so an incomplete pack
           * cannot spread `undefined` over Flipboard's own defaults. Read on
           * every pass, not just the first: a board already built still
           * needs these re-applied on every later pack change, the same as
           * setSkin two lines down - otherwise a slider moved after the
           * first paint (Always flip included) changes nothing on screen.
           */
          const advanced = { ...PACK_DEFAULTS.advanced, ...((pack as any)?.advanced ?? {}) };
          if (!boardRef.current) {
            boardRef.current = new Flipboard(canvas, skin, {
              cols,
              rows,
              padding: 6,
              fastStepMs: advanced.fastStepMs,
              landStepMs: advanced.landStepMs,
              sweepMs: advanced.sweepMs,
              staggerMode: advanced.staggerMode,
              alwaysFlip: advanced.alwaysFlip,
              frameMs: advanced.frameMs,
              // Told, not measured - see Flipboard.resize.
              ...(fixed ? { cssSize: { width, height } } : {}),
            });
            // Fluid boards still have to measure, and the box may still be
            // settling: the ResizeObserver below cannot help, because it fires
            // when it starts observing - before this board exists - and never
            // again if the box does not change afterwards.
            if (!fixed) requestAnimationFrame(() => boardRef.current?.resize());
            boardRef.current.setText(firstText.current, layoutOverrides);
            ambientRef.current = createAmbient(boardRef.current);
            setReady(true);
          } else {
            boardRef.current.setSkin(skin);
            boardRef.current.setOptions({
              fastStepMs: advanced.fastStepMs,
              landStepMs: advanced.landStepMs,
              sweepMs: advanced.sweepMs,
              staggerMode: advanced.staggerMode,
              alwaysFlip: advanced.alwaysFlip,
              frameMs: advanced.frameMs,
            });
          }
          setError('');
        })
        .catch((err: any) => {
          if (!cancelled) setError(err.message);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pack, cols, rows, fixed, width, height]);

  /*
   * A grid resize (a board's card size or screen changing under a preview
   * that's already built) reallocates the tile array by flat index -
   * `setGrid` in flipboard.js, deliberately: it is what lets a message keep
   * flipping through a resize instead of blanking outright. But it does not
   * re-lay the text out for the *new* shape, and nothing else was calling
   * setText either - the effect above only builds a board once and then
   * only ever re-skins it, and the "flip it in again" effect below only
   * fires when the text itself changes. So the tiles that used to spell
   * something sat there reused, one-to-one by index, into a grid with a
   * different width - which reads as blank (mostly padding) far more often
   * than it reads as recognisably garbled. Explicit here: same text,
   * relaid for the grid it now has to fit, snapped rather than flown in -
   * a resize is a discontinuity, not a message worth watching travel.
   *
   * `showing` is read via `firstText` (a ref, already kept current every
   * render for the build effect above) rather than closed over directly -
   * putting the reactive value in this effect's own deps made it re-run on
   * every *text* change too, not just genuine resizes, and immediate:true
   * snapped the tiles to their target before the "flip it in again" effect
   * below got a turn. `setPage` only advances a tile whose current state
   * differs from its target (flipboard.js's `steps === 0` continue), so a
   * tile already snapped there has nothing left to flip - every message
   * change silently stopped animating in, all of it (posters, "Flip
   * again", a design's own live preview) with no error and nothing to
   * suggest why, since the end state was still correct - just no longer
   * flown in.
   */
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    board.setOptions({ cols, rows });
    board.setText(firstText.current, { immediate: true });
  }, [cols, rows]);

  /*
   * Stop drawing while off screen.
   *
   * A wash that moves - a drift - is a reason to keep asking for frames, and
   * that used to mean asking forever. On a page of designs, every card below
   * the fold went on repainting for nobody; at the sixty-design limit that is
   * sixty loops nobody is looking at, which is fan noise on a laptop and
   * worse on the hardware a wall runs on.
   *
   * A board that is not visible is parked and picked up again on the way back.
   * Nothing is lost by it: a drift is a function of the clock, so it resumes
   * where it would have been rather than where it stopped.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const board = boardRef.current;
        if (!board) return;
        if (entry.isIntersecting) board.start?.();
        else board.stop?.();
      },
      { rootMargin: '200px' },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Restarted whenever the setting changes, not just set once - editing
  // Fidget in the sidebar must be visible in this same preview without
  // reopening it.
  useEffect(() => {
    if (!ready) return;
    ambientRef.current?.start(ambientMs);
  }, [ambientMs, ready]);

  // On the way out, for good. A board with anything left to draw otherwise
  // keeps a frame loop alive on a canvas nobody can see, for the life of the
  // tab, one per visit to the page.
  useEffect(
    () => () => {
      ambientRef.current?.destroy();
      ambientRef.current = null;
      boardRef.current?.stop?.();
      boardRef.current = null;
    },
    [],
  );

  // Flip the text in again: blank, then the text, so the motion can be judged.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    // With more than one message, going straight to the next is the point:
    // blanking first would send every tile from the blank and make the travel
    // even again, which is the thing we are trying to show.
    if (replays === 0 || messages.length > 1) {
      board.setText(showing, layoutOverrides);
      return;
    }
    board.clear();
    const timer = setTimeout(() => board.setText(showing, layoutOverrides), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, replays, messages.length, align, valign, wrap]);

  // A board that is demonstrating rather than sitting still.
  useEffect(() => {
    if (!loop || messages.length < 2) return;
    const timer = setInterval(() => setReplays((n) => n + 1), loop);
    return () => clearInterval(timer);
  }, [loop, messages.length]);

  // The canvas box settles after first paint and moves with the window.
  useEffect(() => {
    const canvas = canvasRef.current;
    // A board that was told its size has nothing to watch for.
    if (fixed || !canvas || typeof ResizeObserver === 'undefined') return;
    // Keyed on `ready`, so observing starts once there is a board to resize -
    // and the observer's own first callback becomes the measurement that
    // matters rather than one thrown away on an empty ref.
    if (!ready) return;
    /*
     * Keep the drawing buffer on the box, and keep checking until it settles.
     *
     * A ResizeObserver alone was not enough: it calls back when it starts
     * observing, which for this board was before it existed, and the preview
     * column never changes width afterwards so it never fired again. The board
     * kept whatever it measured mid-layout - a 492x215 buffer inside a 487x270
     * box on one load, 199 tall on the next - and everything painted was
     * stretched by the difference, which is what made square cards look tall.
     *
     */
    const sync = () => {
      boardRef.current?.resize();
    };
    const observer = new ResizeObserver(sync);
    observer.observe(canvas);
    /*
     * And keep re-measuring while the page settles, rather than stopping the
     * moment the buffer agrees with the box.
     *
     * That was the mistake in the first attempt at this: during layout the two
     * agree constantly, at the wrong size each time. This board measured a box
     * of 494x181, matched it, declared itself finished - and the box then
     * became 487x268 without the observer firing again, so everything painted
     * was stretched by the difference and square cards came out half again as
     * tall as they were wide. Agreement is not the same as having settled.
     */
    let frame = 0;
    let raf = requestAnimationFrame(function settle() {
      sync();
      frame += 1;
      if (frame < SETTLE_FRAMES) raf = requestAnimationFrame(settle);
    });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [fixed, ready]);

  /* The board is the input. Rows are lines and columns are characters, so the
     grid is also the limit - you cannot type more than the board can hold, and
     running out of room is something you should feel here rather than discover
     on the wall. Anything outside the ring is left to the layout engine, which
     substitutes and reports. */
  function type(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!onText || typeof text !== 'string') return;
    const lines = text.split('\n');
    const last = () => lines[lines.length - 1] ?? '';

    if (event.key === 'Enter') {
      event.preventDefault();
      if (lines.length >= rows) return;
      onText(`${text}\n`);
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      onText(text.slice(0, -1));
      return;
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur();
      return;
    }
    // One printable character, and no modifier combination we should swallow.
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    if (last().length >= cols) {
      if (lines.length >= rows) return;
      onText(`${text}\n${event.key.toUpperCase()}`);
      return;
    }
    onText(text + event.key.toUpperCase());
  }

  const canvas = (
    <canvas
      ref={canvasRef}
      className={onText ? 'theme-preview-canvas is-editable' : 'theme-preview-canvas'}
      style={
        fixed
          ? { width, height, display: 'block', background: '#0a0a0b', borderRadius: 6 }
          : screenAspect !== undefined
            ? {
                // No width/height, so aspect-ratio (the grid's own, square
                // cards) resolves both together, contained by max-width/
                // max-height below rather than stretched to fill the frame -
                // grid's own default item sizing would stretch, which
                // `place-items: center` on the frame turns off. minWidth/
                // minHeight: 0 for the same reason the frame itself needs
                // them (see its own doc): the canvas is a grid item too (of
                // this frame), so it gets the identical automatic min-size
                // floor - without overriding it here, a grid noticeably
                // taller-relative-to-its-width than the frame (Huge: 8x5 on
                // a 16:9 frame) still won that floor over max-height,
                // overflowed the frame, and the frame's own overflow:
                // hidden clipped it rather than the canvas ever shrinking.
                maxWidth: '100%',
                maxHeight: '100%',
                minWidth: 0,
                minHeight: 0,
                aspectRatio: `${cols} / ${rows}`,
                display: 'block',
                background: '#0a0a0b',
                borderRadius: 6,
              }
            : {
                width: '100%',
                maxWidth: width,
                // The grid's ratio, so square cards land square.
                aspectRatio: `${cols} / ${rows}`,
                display: 'block',
                background: '#0a0a0b',
                borderRadius: 6,
              }
      }
      tabIndex={onText ? 0 : undefined}
      role={onText ? 'textbox' : 'img'}
      aria-multiline={onText ? true : undefined}
      aria-label={
        onText
          ? `The board, ${cols} by ${rows} cards. Click and type to put words on it; Enter starts a new row.`
          : 'Theme preview'
      }
      onKeyDown={onText ? type : undefined}
    />
  );

  return (
    <div className="theme-preview">
      {frameSize ? (
        // Fixed: the frame's own exact box, computed once above rather than
        // left to CSS - nothing here is measured, same as the canvas isn't.
        <div
          className="theme-preview-frame"
          style={{
            width: frameSize.width,
            height: frameSize.height,
            display: 'grid',
            placeItems: 'center',
            background: '#0a0a0b',
            border: '1px solid var(--edge-strong)',
            borderRadius: 6,
          }}
        >
          {canvas}
        </div>
      ) : !fixed && screenAspect !== undefined ? (
        /*
         * The screen's own shape, cards letterboxed inside it - cols/rows
         * is close to this but not exact (integer rounding of a small grid
         * drifts further from it), and without this frame that drift was
         * the box, so the same declared screen visibly changed shape from
         * one card size to the next. Grid + place-items: center, not flex -
         * a flex item with no basis stretches to the cross size by default,
         * which is the one thing this needs to not do.
         */
        <div
          className="theme-preview-frame"
          style={{
            // No maxWidth: width here on purpose - width is cols * tilePx,
            // so an 8-column Huge board and a 48-column Tiny one asked for
            // wildly different caps (a small box, and one wider than any
            // column holding it) for the same declared screen. The frame is
            // the screen; it fills its column the same way at every card
            // size, and cols/rows only change how finely it's divided.
            width: '100%',
            aspectRatio: String(screenAspect),
            display: 'grid',
            placeItems: 'center',
            background: '#0a0a0b',
            border: '1px solid var(--edge-strong)',
            borderRadius: 6,
            // Grid items get an automatic min-height that grows to fit their
            // content, and it wins over aspect-ratio - Huge's canvas (its
            // own aspect-ratio 8/5, taller relative to its width than the
            // frame's 16/9) pushed the frame past its declared ratio to fit
            // it rather than the canvas shrinking to fit the frame. Neither
            // typecheck nor a diff of the server-rendered `style` string
            // catches this - the aspect-ratio in the markup was correct the
            // whole time; only actual layout, which nothing here runs, was
            // wrong. min-height/min-width: 0 is the standard override.
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {canvas}
        </div>
      ) : (
        canvas
      )}
      {bar ? (
        <div className="theme-preview-bar">
          <Button size="sm" variant="ghost" onClick={() => setReplays((n) => n + 1)}>
            Flip
          </Button>
          {error !== '' && <span className="error">{error}</span>}
        </div>
      ) : (
        // No bar, but a failed skin load must still say so somewhere - without
        // this a poster whose design would not build is just a blank rectangle
        // with no signal anywhere on the page.
        error !== '' && <span className="error">{error}</span>
      )}
    </div>
  );
}
