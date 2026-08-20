'use client';

/** The one button. Variants map to intent, never to ad-hoc styling. */
export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}) {
  return (
    <button
      className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`.trim()}
      {...rest}
    />
  );
}

/** A link dressed as a button, for server-rendered navigation. */
export function LinkButton({
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}) {
  return (
    <a className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`.trim()} {...rest} />
  );
}
