/**
 * Text set as split-flap tiles, in CSS - the server-renderable form of the
 * brand mark. The real thing is components/flapper/Flapper.tsx (the actual
 * engine); this is its server-side stand-in and loading fallback. `fit`
 * sizes square tiles to an exact pixel edge so the two occupy the same box
 * and the swap reads as a settle, not a jump.
 *
 * Give it a `pack` and the tiles wear that design - face colours, ink, and the
 * wash across the grid if it has one. Without one they fall back to the tokens,
 * which is what the wordmark and the dashboard cards want.
 */

import { faceStyle } from '@/lib/board/face.mjs';
import { gradientGrid } from '@/lib/board/tint.mjs';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

export function MiniBoard({
  text,
  size = 'md',
  animate = false,
  fit,
  pack,
  cols,
  row = 0,
}: {
  text: string;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
  /** Square tile edge in px; overrides `size` to match a Flapper's geometry. */
  fit?: number;
  /** A design for these tiles to wear. Falls back to the tokens' defaults. */
  pack?: ThemePack | null;
  /** Grid width, for placing a wash. Defaults to this row's own length. */
  cols?: number;
  /** Which row of the grid this is, so a wash lands in the right place. */
  row?: number;
}) {
  const tileStyle = fit
    ? { width: fit, height: fit, fontSize: Math.round(fit * 0.62) }
    : undefined;

  // A wash is a colour per cell. The grid is one row tall here because a
  // MiniBoard is one line; `row` and `cols` place that line inside the board
  // the caller is really drawing, so a two-line poster gets a continuous
  // gradient rather than the same stripe twice.
  const tint = (pack as { tint?: unknown } | undefined)?.tint as
    | { gradient?: { from?: string; to?: string; angle?: number } }
    | null
    | undefined;
  const across = cols ?? text.length;
  const rows = Math.max(1, row + 1);
  const wash =
    tint?.gradient && across > 0
      ? gradientGrid(tint.gradient, across, rows)
      : null;

  return (
    <span
      className={`ui-miniboard ui-miniboard-${size}`}
      role="img"
      aria-label={text}
      style={{
        ...faceStyle(pack),
        ...(fit ? { gap: Math.max(1, Math.round(fit * 0.08)) } : {}),
      }}
    >
      {[...text.toUpperCase()].map((char, index) => {
        const cell = wash ? wash[row * across + index] : null;
        const cellStyle = cell
          ? { '--tile-wash': `rgb(${cell.r},${cell.g},${cell.b})` }
          : undefined;
        return char === ' ' ? (
          <span key={index} className="ui-tile-gap" style={tileStyle} />
        ) : (
          <span
            key={index}
            className={`ui-tile${wash ? ' has-wash' : ''}${animate ? ' flap-in' : ''}`}
            style={{
              ...tileStyle,
              ...cellStyle,
              ...(animate ? ({ '--flap-i': index } as React.CSSProperties) : {}),
            }}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
}
