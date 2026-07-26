import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** A retained conclusion. A vertical 结论 marker column, then the statement. */
export function KeyConclusionObject({ marker = '结论', role = '关键结论', title, detail, style }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr)', gap: 11, overflow: 'hidden', padding: '15px 16px 15px 0', border: '1px solid var(--material-conclusion-edge)', borderRadius: 'var(--radius-md)', background: 'rgba(255,253,247,.95)', ...style }}>
      <div aria-hidden="true" style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 1, borderRight: '1px solid rgba(138,104,52,.18)', color: 'var(--material-conclusion-ink)', fontSize: 'var(--size-micro)', fontWeight: 700, letterSpacing: 'var(--track-eyebrow)', writingMode: 'vertical-rl' }}>{marker}</div>
      <div style={{ minWidth: 0 }}>
        <RoleLabel family="keyConclusion">{role}</RoleLabel>
        <h3 style={{ margin: '9px 0 0', color: 'var(--text-primary)', fontSize: 'var(--size-body)', fontWeight: 'var(--weight-strong)', lineHeight: 1.42, overflowWrap: 'anywhere' }}>{title}</h3>
        {detail ? <p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--size-body-s)', fontWeight: 430, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{detail}</p> : null}
      </div>
    </div>
  );
}
