import React from 'react';

const GLASS = {
  border: '1px solid var(--morpho-glass-border)',
  background: 'var(--morpho-glass-bg)',
  backdropFilter: 'var(--morpho-glass-blur)',
  WebkitBackdropFilter: 'var(--morpho-glass-blur)'
};

/**
 * A small frosted control cluster over the canvas. Morpho uses two — identity
 * top-left, actions top-right — instead of a navigation bar.
 */
export function FloatingCluster({ side = 'left', children, style }) {
  return (
    <div style={{
      position: 'absolute', zIndex: 30, top: 'var(--cluster-top)', minHeight: 42,
      left: side === 'left' ? 'var(--cluster-inset)' : undefined,
      right: side === 'right' ? 'var(--cluster-inset)' : undefined,
      display: 'flex', alignItems: 'center', gap: side === 'left' ? 7 : 5, padding: 6,
      borderRadius: 'var(--radius-cluster)', boxShadow: 'var(--shadow-float)', ...GLASS, ...style
    }}>{children}</div>
  );
}

/** A tight group of related controls inside a cluster. */
export function ToolbarGroup({ label, children, style }) {
  return <div role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...style }}>{children}</div>;
}

/** The Morpho wordmark. There is no logotype file — the mark is set type. */
export function Wordmark({ size = 20, style }) {
  return <div style={{ padding: '0 5px 0 2px', fontSize: size, fontWeight: 650, letterSpacing: 0, color: 'var(--text-primary)', ...style }}>Morpho</div>;
}

/** Project identity: a brand dot, the name, a quiet subtitle, a menu caret. */
export function ProjectName({ name, subtitle = '· 概念工作台', warning, caret, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, height: 31, padding: '0 9px',
        border: 0, borderLeft: '1px solid var(--border-subtle)', borderRadius: 9,
        background: 'transparent', color: hover ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer', fontSize: 'var(--size-body-s)', lineHeight: 1.2, fontFamily: 'var(--font-sans)', ...style
      }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-brand)' }}></span>
      <strong style={{ maxWidth: 220, overflow: 'hidden', color: 'var(--text-primary)', fontWeight: 'var(--weight-mid)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</strong>
      {subtitle ? <span style={{ maxWidth: 112, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span> : null}
      {caret}
      {warning ? <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 22, padding: '2px 7px', border: '1px solid rgba(138,104,52,.22)', borderRadius: 6, background: 'rgba(238,224,212,.54)', color: 'var(--warning)', fontSize: 'var(--size-label)', fontWeight: 'var(--weight-mid)' }}>{warning}</span> : null}
    </button>
  );
}

/** Hairline divider inside a cluster. */
export function ClusterDivider({ style }) {
  return <div style={{ width: 1, height: 20, background: 'var(--border-subtle)', ...style }}></div>;
}
