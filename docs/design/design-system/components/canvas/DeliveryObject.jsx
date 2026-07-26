import React from 'react';
import { RoleLabel } from './RoleLabel.jsx';
import { ProductVisual } from './ProductVisual.jsx';

/** A 交付准备 module. Sage edge, wireframe of the assembled page. */
export function DeliveryObject({ role = '交付准备', title, note, preview, style }) {
  return (
    <div style={{ padding: 16, border: '1px solid var(--material-delivery-edge)', borderRadius: 'var(--radius-md)', background: 'rgba(248,250,246,.94)', boxShadow: '0 6px 16px rgba(30,24,18,.03)', ...style }}>
      <RoleLabel family="delivery">{role}</RoleLabel>
      <h3 style={{ margin: '9px 0 0', color: 'var(--text-primary)', fontSize: 'var(--size-title-s)', fontWeight: 'var(--weight-mid)', lineHeight: 1.35 }}>{title}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 8, marginTop: 12, padding: 8, borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,.45)' }}>
        <div style={{ height: 100, overflow: 'hidden', border: '1px solid rgba(78,107,82,.18)', borderRadius: 6, background: '#fff' }}>{preview || <ProductVisual variant="rail" />}</div>
        <div style={{ minHeight: 100, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, padding: 10, border: '1px solid rgba(78,107,82,.14)', borderRadius: 6, background: 'rgba(255,255,255,.72)' }}>
          <span style={{ width: '82%', height: 3, background: 'var(--border-strong)' }}></span>
          <span style={{ width: '58%', height: 3, background: 'var(--border-strong)' }}></span>
          <span style={{ width: '70%', height: 3, background: 'var(--accent-brand-soft)' }}></span>
        </div>
      </div>
      {note ? <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--size-label)', lineHeight: 1.5 }}>{note}</p> : null}
    </div>
  );
}
