import React from 'react';

/** Graphite micro-label revealed on hover, used by rail buttons. */
export function Tooltip({ children, visible = false, style }) {
  return (
    <span style={{
      position: 'absolute', zIndex: 2, top: '50%', left: 'calc(100% + 10px)',
      padding: '7px 8px', borderRadius: 7, background: 'var(--text-primary)', color: '#fff',
      fontSize: 'var(--size-micro)', letterSpacing: '.02em', whiteSpace: 'nowrap', pointerEvents: 'none',
      boxShadow: '0 8px 18px rgba(30,24,18,.16)', opacity: visible ? 1 : 0,
      transform: visible ? 'translate(0, -50%)' : 'translate(-4px, -50%)',
      transition: 'opacity 160ms ease, transform 160ms ease', ...style
    }}>{children}</span>
  );
}
