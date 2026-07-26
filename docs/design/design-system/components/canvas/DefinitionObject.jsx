import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** The 设计定义 object: a 5px umber bar and a document-weight title. */
export function DefinitionObject({ role = '设计定义', title, summary, statuses = [], style }) {
  return (
    <div style={{ position: 'relative', padding: '18px 20px 18px 24px', border: 0, borderRadius: '0 8px 8px 0', background: 'rgba(255,253,249,.96)', boxShadow: '0 8px 20px rgba(30,24,18,.045)', ...style }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 5, background: 'var(--accent-brand)' }}></span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <RoleLabel family="designDefinition">{role}</RoleLabel>
        <span style={{ color: 'var(--accent-brand)', fontSize: 'var(--size-micro)', fontWeight: 700, letterSpacing: 'var(--track-marker)' }}>定义</span>
      </div>
      <h3 style={{ margin: '14px 0 9px', color: 'var(--text-primary)', fontSize: 'var(--size-title)', fontWeight: 520, lineHeight: 'var(--leading-tight)', letterSpacing: 'var(--track-heading)', overflowWrap: 'anywhere' }}>{title}</h3>
      {summary ? <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--size-body-s)', lineHeight: 1.58, overflowWrap: 'anywhere' }}>{summary}</p> : null}
      {statuses.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 13 }}>
          {statuses.map((s, i) => <span key={i} style={{ display: 'inline-flex', width: 'fit-content', padding: '4px 7px', borderRadius: 'var(--radius-pill)', background: 'rgba(142,76,36,.08)', color: 'var(--accent-brand)', fontSize: 'var(--size-micro)', fontWeight: 'var(--weight-semibold)' }}>{s}</span>)}
        </div>
      ) : null}
    </div>
  );
}
