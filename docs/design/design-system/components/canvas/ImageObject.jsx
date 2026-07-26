import React from 'react';

/**
 * An image object. The picture is the object: a square-cornered visual with a
 * soft float shadow, and the role + title floating *below* the frame — not a
 * card with a footer.
 */
export function ImageObject({ role, title, src, alt = '', width = 320, height = 214, editing = false, children, style }) {
  return (
    <div style={{ position: 'relative', width, ...style }}>
      <div style={{ position: 'relative', width, height, overflow: 'hidden', borderRadius: 'var(--radius-object)', border: '1px solid var(--hairline)', background: 'rgba(255,255,255,.34)', boxShadow: 'var(--shadow-image)' }}>
        {src ? <img src={src} alt={alt} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }} /> : children}
        {editing ? (
          <div aria-hidden="true" style={{ position: 'absolute', zIndex: 3, top: '26%', right: '18%', width: 96, height: 78, border: '2px dashed var(--accent-brand)', borderRadius: '50%', color: 'var(--accent-brand)' }}>
            <span style={{ position: 'absolute', top: -19, right: -48, width: 54, height: 2, background: 'var(--accent-brand)', transform: 'rotate(-28deg)', transformOrigin: 'left center' }}></span>
            <p style={{ position: 'absolute', top: -34, right: -92, width: 78, margin: 0, color: 'var(--accent-brand)', fontSize: 'var(--size-micro)', fontWeight: 'var(--weight-semibold)', lineHeight: 1.2 }}>局部编辑中</p>
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 21, marginTop: 8, padding: '0 2px', pointerEvents: 'none' }}>
        {role ? <span style={{ flex: '0 0 auto', padding: '3px 5px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-sm)', background: 'rgba(252,251,248,.88)', color: 'var(--text-muted)', fontSize: 'var(--size-nano)', fontWeight: 'var(--weight-semibold)' }}>{role}</span> : null}
        <strong style={{ minWidth: 0, overflow: 'hidden', color: 'var(--text-secondary)', fontSize: 'var(--size-micro)', fontWeight: 'var(--weight-mid)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
      </div>
    </div>
  );
}
