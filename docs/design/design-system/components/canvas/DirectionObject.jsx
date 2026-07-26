import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** A 概念方向 object: circled arrow head, ruled title, keyword line. */
export function DirectionObject({ role = '概念方向', title, summary, keywords, style }) {
  return (
    <div style={{ padding: '16px 18px 17px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)', background: 'rgba(252,253,252,.94)', boxShadow: '0 4px 13px rgba(30,24,18,.025)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <RoleLabel family="conceptDirection">{role}</RoleLabel>
        <span aria-hidden="true" style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', border: '1px solid rgba(109,127,136,.26)', borderRadius: '50%', color: 'rgba(109,127,136,.8)', fontSize: 'var(--size-body)' }}>→</span>
      </div>
      <h3 style={{ margin: '13px 0 0', paddingBottom: 10, borderBottom: '1px solid var(--hairline-quiet)', color: 'var(--text-primary)', fontSize: 'var(--size-title-s)', fontWeight: 570, lineHeight: 1.35 }}>{title}</h3>
      {summary ? <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--size-label)', lineHeight: 1.55 }}>{summary}</p> : null}
      {keywords ? <small style={{ display: 'inline-block', marginTop: 13, paddingTop: 6, borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 'var(--size-micro)', lineHeight: 1.4 }}>{keywords}</small> : null}
    </div>
  );
}
