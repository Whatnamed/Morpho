import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** An imported file. A 4px blue-gray spine plus three ghost text lines. */
export function FileObject({ role = '文件', title, summary, style }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', padding: '15px 16px 14px 20px', border: '1px solid rgba(78,68,58,.11)', borderRadius: '4px 10px 10px 4px', background: 'rgba(255,254,251,.94)', boxShadow: 'var(--shadow-object-soft)', ...style }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 4, background: 'var(--material-file-spine)' }}></span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <RoleLabel family="file">{role}</RoleLabel>
        <span aria-hidden="true" style={{ width: 8, height: 10, display: 'block', border: '1px solid rgba(120,100,82,.42)', borderRadius: 1 }}></span>
      </div>
      <h3 style={{ margin: '12px 0 7px', fontSize: 'var(--size-body-l)', fontWeight: 600, lineHeight: 1.35, color: 'var(--text-primary)' }}>{title}</h3>
      {summary ? <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--size-label)', lineHeight: 1.55 }}>{summary}</p> : null}
      <div aria-hidden="true" style={{ display: 'grid', gap: 4, marginTop: 13 }}>
        {['100%', '76%', '48%'].map((w, i) => <span key={i} style={{ width: w, height: 2, display: 'block', borderRadius: 999, background: 'rgba(78,68,58,.09)' }}></span>)}
      </div>
    </div>
  );
}
