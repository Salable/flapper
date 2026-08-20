/**
 * Text set as split-flap tiles - the brand mark. Server-safe; add `animate`
 * for the staggered flap-in entrance (CSS handles reduced motion).
 */
export function MiniBoard({
  text,
  size = 'md',
  animate = false,
}: {
  text: string;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
}) {
  return (
    <span className={`ui-miniboard ui-miniboard-${size}`} role="img" aria-label={text}>
      {[...text.toUpperCase()].map((char, index) =>
        char === ' ' ? (
          <span key={index} className="ui-tile-gap" />
        ) : (
          <span
            key={index}
            className={`ui-tile${animate ? ' flap-in' : ''}`}
            style={animate ? ({ '--flap-i': index } as React.CSSProperties) : undefined}
          >
            {char}
          </span>
        ),
      )}
    </span>
  );
}
