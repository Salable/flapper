/**
 * Text set as split-flap tiles, in CSS - the server-renderable form of the
 * brand mark. The real thing is components/flapper/Flapper.tsx (the actual
 * engine); this is its server-side stand-in and loading fallback. `fit`
 * sizes square tiles to an exact pixel edge so the two occupy the same box
 * and the swap reads as a settle, not a jump.
 */
export function MiniBoard({
  text,
  size = 'md',
  animate = false,
  fit,
}: {
  text: string;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
  /** Square tile edge in px; overrides `size` to match a Flapper's geometry. */
  fit?: number;
}) {
  const tileStyle = fit
    ? { width: fit, height: fit, fontSize: Math.round(fit * 0.62) }
    : undefined;
  return (
    <span
      className={`ui-miniboard ui-miniboard-${size}`}
      role="img"
      aria-label={text}
      style={fit ? { gap: Math.max(1, Math.round(fit * 0.08)) } : undefined}
    >
      {[...text.toUpperCase()].map((char, index) =>
        char === ' ' ? (
          <span key={index} className="ui-tile-gap" style={tileStyle} />
        ) : (
          <span
            key={index}
            className={`ui-tile${animate ? ' flap-in' : ''}`}
            style={{
              ...tileStyle,
              ...(animate ? ({ '--flap-i': index } as React.CSSProperties) : {}),
            }}
          >
            {char}
          </span>
        ),
      )}
    </span>
  );
}
