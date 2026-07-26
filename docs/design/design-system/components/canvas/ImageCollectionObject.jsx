import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** A group of images. A diagonal sheen suggests the stack. */
export function ImageCollectionObject({ role = '图片合集', title, summary, count, style }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', padding: '15px 16px 16px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-object)', background: 'linear-gradient(135deg, rgba(255,255,255,.5) 0 42%, transparent 42%), rgba(252,249,244,.9)', boxShadow: 'var(--shadow-object)', ...style }}>
      <RoleLabel>{role}</RoleLabel>
      <h3 style={{ margin: '9px 0 0', color: 'var(--text-primary)', fontSize: 'var(--size-body-l)', fontWeight: 570, lineHeight: 1.35 }}>{title}</h3>
      {summary ? <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--size-label)', lineHeight: 1.55 }}>{summary}</p> : null}
      {count != null ? <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 'var(--size-label)', lineHeight: 1.55 }}>成员：{count} 张</p> : null}
    </div>
  );
}
