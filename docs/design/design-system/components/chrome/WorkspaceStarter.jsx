import React from 'react';

/** The low-pressure first screen on a blank project. Never blocks the canvas. */
export function WorkspaceStarter({ kicker = '新项目', title, body, actions, hint, style }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 24px 120px', pointerEvents: 'none', ...style }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: 430, padding: '30px 34px 26px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', background: 'rgba(252,251,248,.88)', boxShadow: 'var(--shadow-panel)', backdropFilter: 'blur(14px) saturate(1.04)', textAlign: 'center' }}>
        <span style={{ color: 'var(--accent-brand)', fontSize: 'var(--size-label)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--track-eyebrow)' }}>{kicker}</span>
        <h2 style={{ margin: 0, fontSize: 21, fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--track-heading)' }}>{title}</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--size-body)', lineHeight: 1.6 }}>{body}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 10, pointerEvents: 'auto' }}>{actions}</div>
        {hint ? <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 'var(--size-body-s)' }}>{hint}</p> : null}
      </div>
    </div>
  );
}

/** A transient save confirmation under the top clusters. */
export function SaveToast({ visible = false, children, style }) {
  return (
    <div style={{
      position: 'absolute', top: 78, left: '50%', zIndex: 70, transform: 'translateX(-50%)',
      minHeight: 30, padding: '7px 12px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-object)',
      background: 'rgba(252,251,248,.86)', boxShadow: '0 8px 24px rgba(30,24,18,.06)',
      color: 'var(--text-secondary)', fontSize: 'var(--size-body-s)', fontWeight: 'var(--weight-mid)',
      backdropFilter: 'blur(16px)', pointerEvents: 'none',
      opacity: visible ? 1 : 0, transition: 'opacity var(--duration-ui) var(--ease-out)', ...style
    }}>{children}</div>
  );
}
