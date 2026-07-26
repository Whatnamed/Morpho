import React from 'react';

const MARKS = {
  file: { width: 9, height: 11, border: '1px solid currentColor', background: 'transparent', opacity: 0.72 },
  documentFragment: { width: 3, height: 12, background: 'currentColor', opacity: 0.72 },
  research: { width: 14, height: 2, background: 'currentColor' },
  keyConclusion: { width: 7, height: 7, borderRadius: '50%', background: 'currentColor', opacity: 0.65 },
  designDefinition: { width: 2, height: 12, background: 'var(--accent-brand)', opacity: 0.7 },
  conceptDirection: { width: 8, height: 8, border: '1px solid currentColor', borderRadius: '50%', background: 'transparent', opacity: 0.72 },
  proposalDraft: { width: 8, height: 8, border: '1px solid currentColor', background: 'transparent', opacity: 0.72 },
  text: { width: 12, height: 1, background: 'currentColor', opacity: 0.48 },
  delivery: { width: 12, height: 2, background: 'rgba(78,107,82,.7)' },
  default: { width: 14, height: 1, background: 'currentColor', opacity: 0.68 }
};

/**
 * The eyebrow on every canvas object. Its leading mark is different per object
 * family — that mark is how a user tells the materials apart at a glance.
 */
export function RoleLabel({ children, family = 'default', color, style }) {
  const mark = MARKS[family] || MARKS.default;
  const tone = family === 'keyConclusion' ? 'rgba(78,68,58,.58)' : 'var(--text-muted)';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: color || tone, fontSize: 'var(--size-micro)', fontWeight: 'var(--weight-semibold)', letterSpacing: family === 'keyConclusion' ? '0.045em' : '0.055em', lineHeight: 1, ...style }}>
      <span aria-hidden="true" style={{ flex: '0 0 auto', display: 'block', ...mark }}></span>
      {children}
    </div>
  );
}
