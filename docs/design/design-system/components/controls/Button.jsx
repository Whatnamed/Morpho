import React from 'react';

/**
 * Morpho's button. Three shipped variants share one 28px height and a soft
 * hover fill; only `brand` carries the umber. Press scales to .97.
 */
export function Button({ variant = 'plain', icon, children, disabled = false, onClick, title, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const [down, setDown] = React.useState(false);
  const isIcon = variant === 'icon';
  const isBrand = variant === 'brand';
  const base = {
    height: 28, minWidth: 28, border: 0, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.48 : 1, display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', gap: 6, fontFamily: 'var(--font-sans)',
    transition: 'background var(--duration-fast) ease, border-color var(--duration-fast) ease, color var(--duration-fast) ease, transform 120ms ease',
    transform: down && !disabled ? 'scale(var(--press-scale))' : 'none'
  };
  const skin = isBrand
    ? { padding: '0 11px', borderRadius: 'var(--radius-control)', border: '1px solid rgba(142,76,36,.18)',
        background: hover && !disabled ? 'var(--accent-brand-hover)' : 'var(--accent-brand)', color: '#fff',
        fontSize: 'var(--size-label)', fontWeight: 'var(--weight-strong)',
        boxShadow: '0 7px 18px rgba(142,76,36,.14), 0 1px 0 rgba(255,255,255,.12) inset' }
    : isIcon
      ? { width: 30, padding: 0, borderRadius: 'var(--radius-icon-button)',
          background: hover && !disabled ? 'var(--surface-muted)' : 'transparent',
          color: hover && !disabled ? 'var(--text-primary)' : 'var(--text-secondary)' }
      : { padding: '0 8px', borderRadius: 'var(--radius-control)', border: '1px solid var(--hairline-quiet)',
          background: hover && !disabled ? 'var(--surface-muted)' : 'rgba(255,255,255,.34)',
          color: hover && !disabled ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 'var(--size-label)', fontWeight: 520 };
  return (
    <button type="button" onClick={disabled ? undefined : onClick} title={title} disabled={disabled}
      aria-label={isIcon ? title : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setDown(false); }}
      onMouseDown={() => setDown(true)} onMouseUp={() => setDown(false)}
      style={{ ...base, ...skin, ...style }} {...rest}>{icon}{children}</button>
  );
}
