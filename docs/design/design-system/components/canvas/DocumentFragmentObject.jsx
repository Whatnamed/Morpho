import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** An excerpt pulled out of a document. Inset quote rule, no border. */
export function DocumentFragmentObject({ role = '文档片段', title, lines = [], style }) {
  return (
    <div style={{ position: 'relative', padding: '16px 18px 16px 22px', border: 0, borderRadius: 3, background: 'rgba(249,248,244,.94)', boxShadow: 'var(--shadow-object)', ...style }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 16, bottom: 16, left: 10, width: 2, borderRadius: 2, background: 'var(--material-fragment-rule)' }}></span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <RoleLabel family="documentFragment">{role}</RoleLabel>
        <span aria-hidden="true" style={{ color: 'rgba(120,100,82,.72)', fontSize: 'var(--size-body-s)', fontWeight: 'var(--weight-semibold)' }}>摘</span>
      </div>
      <h3 style={{ margin: '11px 0 7px', fontSize: 'var(--size-body-l)', fontWeight: 600, lineHeight: 1.35, color: 'var(--text-primary)' }}>{title}</h3>
      <div style={{ display: 'grid', gap: 9 }}>
        {lines.map((l, i) => <p key={i} style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--size-label)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{l}</p>)}
      </div>
    </div>
  );
}
