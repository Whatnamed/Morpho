import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';

/** A 待确认草案 on the canvas: umber edge, folded corner, 待确认 pill. */
export function ProposalDraftObject({ role = '待确认草案', state = '待确认', title, summary, style }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', padding: '18px 19px', border: '1px solid var(--material-draft-edge)', borderRadius: 7, background: 'rgba(255,252,247,.96)', boxShadow: '0 7px 18px rgba(30,24,18,.035)', ...style }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: -1, right: -1, width: 24, height: 24, borderBottom: '1px solid rgba(142,76,36,.16)', borderLeft: '1px solid rgba(142,76,36,.16)', background: 'var(--canvas)', transform: 'translate(10px,-10px) rotate(45deg)' }}></span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <RoleLabel family="proposalDraft">{role}</RoleLabel>
        <span style={{ flex: '0 0 auto', padding: '3px 6px', border: '1px solid rgba(142,76,36,.19)', borderRadius: 'var(--radius-pill)', color: 'var(--accent-brand)', fontSize: 'var(--size-nano)', fontWeight: 'var(--weight-semibold)' }}>{state}</span>
      </div>
      <h3 style={{ margin: '10px 0 0', color: 'var(--text-primary)', fontSize: 'var(--size-title-s)', fontWeight: 580, lineHeight: 1.36, overflowWrap: 'anywhere' }}>{title}</h3>
      {summary ? <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--size-body-s)', lineHeight: 1.58, overflowWrap: 'anywhere' }}>{summary}</p> : null}
    </div>
  );
}
