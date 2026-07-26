import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** A plain note the user typed onto the canvas. Barely a card. */
export function TextObject({ role = '文本', title, lines = [], style }) {
  return (
    <div style={{ position: 'relative', padding: '15px 17px', border: 0, borderRadius: 0, background: 'rgba(252,251,248,.72)', ...style }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 17, left: 0, width: 2, height: 28, background: 'rgba(78,68,58,.28)' }}></span>
      <RoleLabel family="text">{role}</RoleLabel>
      <h3 style={{ margin: '10px 0 0', color: 'var(--text-primary)', fontSize: 'var(--size-body-l)', fontWeight: 'var(--weight-mid)', lineHeight: 1.35 }}>{title}</h3>
      <div style={{ display: 'grid', gap: 9, marginTop: 9 }}>
        {lines.map((l, i) => <p key={i} style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--size-label)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{l}</p>)}
      </div>
    </div>
  );
}
