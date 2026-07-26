import React from 'react';

/**
 * The bottom detail surface. Appears only when something is selected: object
 * chip, tab strip, one scrolling stack of rows, and a few inline actions.
 * It is not a full-height inspector and never becomes one.
 */
export function DetailPopover({ visible = false, type, title, tabs = [], activeTab, onTab, actions, children, style }) {
  return (
    <div aria-label="对象详情" style={{
      position: 'absolute', zIndex: 40, left: '50%', bottom: 28,
      width: 'var(--detail-popover-width)', maxHeight: 'min(34vh, 320px)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px 14px',
      border: '1px solid var(--morpho-glass-border)', borderRadius: 16,
      background: 'rgba(252,251,248,.94)', boxShadow: '0 16px 40px rgba(30,24,18,.1)',
      backdropFilter: 'var(--blur-toolbar)', WebkitBackdropFilter: 'var(--blur-toolbar)',
      opacity: visible ? 1 : 0, visibility: visible ? 'visible' : 'hidden',
      transform: visible ? 'translateX(-50%)' : 'translateX(-50%) translateY(6px)',
      transition: 'opacity var(--duration-ui) var(--ease-out), transform var(--duration-ui) var(--ease-out), visibility var(--duration-ui)',
      ...style
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 12px', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--hairline-quiet)' }}>
        <div title={typeof title === 'string' ? title : undefined} style={{ minWidth: 0, maxWidth: 'min(280px, 46vw)', display: 'grid', gap: 2 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--size-micro)', fontWeight: 'var(--weight-semibold)', letterSpacing: '.04em' }}>{type}</span>
          <strong style={{ overflow: 'hidden', color: 'var(--text-primary)', fontSize: 'var(--size-body)', fontWeight: 'var(--weight-strong)', lineHeight: 1.3, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
        </div>
        <div role="tablist" aria-label="详情分类" style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: 2, borderRadius: 'var(--radius-object)', background: 'rgba(240,236,230,.55)' }}>
          {tabs.map(t => {
            const on = t === activeTab;
            return (
              <button key={t} type="button" role="tab" aria-selected={on} onClick={() => onTab && onTab(t)}
                style={{ minHeight: 26, padding: '4px 9px', border: 0, borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--size-label)', fontWeight: 'var(--weight-mid)', fontFamily: 'var(--font-sans)', background: on ? 'rgba(255,255,255,.88)' : 'transparent', color: on ? 'var(--text-primary)' : 'var(--text-secondary)', boxShadow: on ? '0 1px 3px rgba(30,24,18,.06)' : 'none', transition: 'background var(--duration-fast) ease, color var(--duration-fast) ease' }}>{t}</button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflow: 'hidden', color: 'var(--text-secondary)', fontSize: 'var(--size-body-s)', lineHeight: 1.62 }}>
        <div style={{ minHeight: 0, overflowY: 'auto', paddingRight: 2, display: 'grid', gap: 4 }}>{children}</div>
        {actions ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: '0 0 auto', paddingTop: 2 }}>{actions}</div> : null}
      </div>
    </div>
  );
}

/** A label / body row inside the detail stack. */
export function DetailRow({ label, children, meta, thumbnail, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  const inner = (
    <>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--size-label)', lineHeight: 1.55 }}>{label}</span>
      {thumbnail ? (
        <div style={{ minWidth: 0, display: 'grid', gridTemplateColumns: '32px minmax(0,1fr)', gap: 9, alignItems: 'center' }}>
          <span aria-hidden="true" style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', overflow: 'hidden', border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'var(--surface-muted)', color: 'var(--text-secondary)', fontSize: 'var(--size-micro)', lineHeight: 1 }}>{thumbnail}</span>
          <div style={{ minWidth: 0, display: 'grid', gap: 1 }}>
            <strong style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-strong)', overflowWrap: 'anywhere' }}>{children}</strong>
            {meta ? <span style={{ color: 'var(--text-muted)', fontSize: 'var(--size-label)' }}>{meta}</span> : null}
          </div>
        </div>
      ) : (
        <div style={{ minWidth: 0, display: 'grid', gap: 1 }}>
          <span style={{ overflowWrap: 'anywhere' }}>{children}</span>
          {meta ? <span style={{ color: 'var(--text-muted)', fontSize: 'var(--size-label)' }}>{meta}</span> : null}
        </div>
      )}
    </>
  );
  const base = { display: 'grid', gridTemplateColumns: '76px minmax(0,1fr)', gap: 10, alignItems: 'start', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', ...style };
  if (!onClick) return <div style={base}>{inner}</div>;
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...base, width: '100%', border: 0, borderBottom: '1px solid var(--border-subtle)', borderRadius: 6, background: hover ? 'rgba(109,127,136,.07)' : 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left', transition: 'background-color 160ms ease' }}>{inner}</button>
  );
}

/** A pill action at the foot of the detail popover. */
export function DetailInlineAction({ icon, children, disabled = false, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  const on = hover && !disabled;
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content', minHeight: 28,
        padding: '6px 9px', border: '1px solid ' + (on ? 'rgba(109,127,136,.22)' : 'var(--hairline)'),
        borderRadius: 'var(--radius-pill)', background: on ? 'rgba(228,234,235,.72)' : 'rgba(255,255,255,.58)',
        color: disabled ? 'var(--text-muted)' : on ? 'var(--accent-select)' : 'var(--text-primary)',
        cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 'var(--size-body-s)', fontWeight: 'var(--weight-mid)',
        fontFamily: 'var(--font-sans)', transition: 'background var(--duration-fast) ease, border-color var(--duration-fast) ease, color var(--duration-fast) ease', ...style
      }}>{icon}{children}</button>
  );
}

/** A muted metadata line inside the detail stack. */
export function DetailMeta({ children, style }) {
  return <span style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)', fontSize: 'var(--size-label)', lineHeight: 1.45, ...style }}>{children}</span>;
}
