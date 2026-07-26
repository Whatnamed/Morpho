import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** A linked web source. Marked by a small corner arrow. */
export function LinkObject({ role = '链接', title, url, description, style }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', padding: '15px 16px 16px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-object)', background: 'rgba(250,249,246,.9)', boxShadow: 'var(--shadow-object)', ...style }}>
      <RoleLabel>{role}</RoleLabel>
      <h3 style={{ margin: '9px 0 0', color: 'var(--text-primary)', fontSize: 'var(--size-body-l)', fontWeight: 570, lineHeight: 1.35 }}>{title}</h3>
      {url ? <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--size-label)', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{url}</p> : null}
      {description ? <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 'var(--size-label)', lineHeight: 1.55 }}>{description}</p> : null}
      <span aria-hidden="true" style={{ position: 'absolute', right: 14, bottom: 14, width: 14, height: 14, borderRight: '1.5px solid rgba(109,127,136,.45)', borderBottom: '1.5px solid rgba(109,127,136,.45)', transform: 'rotate(-45deg)', opacity: 0.7 }}></span>
    </div>
  );
}
