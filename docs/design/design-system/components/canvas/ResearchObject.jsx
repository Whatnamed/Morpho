import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** A saved 研究与分析 object. Warm paper with a small double-rule mark. */
export function ResearchObject({ role = '研究与分析', title, summary, style }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', padding: '16px 18px 17px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)', background: 'rgba(255,252,247,.96)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <RoleLabel family="research">{role}</RoleLabel>
        <span style={{ color: 'rgba(142,76,36,.62)', fontSize: 'var(--size-micro)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--track-eyebrow)' }}>分析</span>
      </div>
      <h3 style={{ margin: '12px 0 0', paddingRight: 32, color: 'var(--text-primary)', fontSize: 'var(--size-title-s)', fontWeight: 'var(--weight-medium)', lineHeight: 'var(--leading-tight)', overflowWrap: 'anywhere' }}>{title}</h3>
      {summary ? <p style={{ margin: '7px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--size-label)', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{summary}</p> : null}
      <span aria-hidden="true" style={{ position: 'absolute', right: 16, bottom: 14, width: 30, height: 18, borderTop: '1px solid var(--material-research-mark)', borderBottom: '1px solid var(--material-research-mark)' }}></span>
    </div>
  );
}
