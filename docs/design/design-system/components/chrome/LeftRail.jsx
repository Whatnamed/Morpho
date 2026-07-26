import React from 'react';
import { Tooltip } from '../controls/Tooltip.jsx';

/** The narrow frosted rail, vertically centred against the canvas edge. */
export function LeftRail({ children, style }) {
  return (
    <aside aria-label="工作台导航" style={{
      position: 'absolute', zIndex: 50, top: '50%', left: 'var(--rail-left)', width: 'var(--rail-width)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '7px 6px 8px',
      border: '1px solid var(--morpho-glass-border)', borderRadius: 'var(--radius-rail)',
      background: 'var(--morpho-glass-bg)', backdropFilter: 'var(--morpho-glass-blur)',
      WebkitBackdropFilter: 'var(--morpho-glass-blur)', boxShadow: 'var(--shadow-float)',
      transform: 'translateY(-50%)', overflow: 'visible', ...style
    }}>{children}</aside>
  );
}

/** A 32px control in the rail, with its hover tooltip. */
export function RailButton({ icon, label, active = false, create = false, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  const skin = create
    ? { background: hover ? 'var(--surface-raised)' : '#fff', color: hover ? 'var(--accent-brand-hover)' : 'var(--accent-brand)', border: '1px solid var(--border-strong)', borderRadius: '50%', marginBottom: 6, boxShadow: hover ? '0 6px 14px rgba(30,24,18,.08)' : '0 4px 12px rgba(30,24,18,.06)' }
    : active
      ? { background: 'var(--accent-brand-soft)', color: 'var(--accent-brand)', boxShadow: 'inset 0 0 0 1px rgba(142,76,36,.1)' }
      : { background: hover ? 'var(--surface-muted)' : 'transparent', color: hover ? 'var(--text-primary)' : 'var(--text-secondary)' };
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} title={label}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', width: 32, height: 32, border: 0, borderRadius: 'var(--radius-icon-button)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'background 140ms ease, color 140ms ease, box-shadow 140ms ease', ...skin, ...style }}>
      {icon}
      <Tooltip visible={hover && !active}>{label}</Tooltip>
    </button>
  );
}

/** Hairline separator between rail groups. */
export function RailSeparator({ style }) {
  return <div style={{ width: 24, height: 1, margin: '4px 0', background: 'var(--border-subtle)', ...style }}></div>;
}
