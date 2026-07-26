import React from 'react';

/**
 * A rail drawer: project map, assets, hidden content, project records.
 * Bottom-aligned with the AI panel so both sit in the same free band.
 */
export function SideDrawer({ open = false, title, meta, children, style }) {
  return (
    <section aria-label={typeof title === 'string' ? title : '抽屉'} style={{
      position: 'absolute', zIndex: 45, top: 'auto', bottom: 'var(--drawer-bottom)', left: 'var(--drawer-left)',
      width: 'var(--drawer-width)', maxHeight: 'calc(100% - 84px - 82px)', overflow: 'auto', padding: 17,
      border: '1px solid var(--hairline)', borderRadius: 'var(--radius-lg)',
      background: 'var(--panel-plate), var(--surface)', boxShadow: 'var(--shadow-drawer)',
      backdropFilter: 'var(--blur-popover)', WebkitBackdropFilter: 'var(--blur-popover)',
      opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden',
      transform: open ? 'translateY(0) scale(1)' : 'translateY(6px) scale(.985)',
      transition: 'opacity var(--duration-ui) var(--ease-out), transform var(--duration-ui) var(--ease-out), visibility var(--duration-ui)',
      ...style
    }}>
      {(title || meta) ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 'var(--size-body)', fontWeight: 'var(--weight-semibold)' }}>{title}</div>
          {meta}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A muted explanatory line inside a drawer. */
export function DrawerNote({ children, style }) {
  return <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--size-body-s)', lineHeight: 1.55, ...style }}>{children}</p>;
}

/** An uppercase group heading between drawer sections. */
export function DrawerGroupTitle({ children, style }) {
  return <div style={{ margin: '14px 0 8px', color: 'var(--text-muted)', fontSize: 'var(--size-micro)', fontWeight: 'var(--weight-heavy)', letterSpacing: 'var(--track-label)', ...style }}>{children}</div>;
}

/** A navigation row in the project map. Moves the canvas; never changes page. */
export function MapItem({ children, meta = '↗', active = false, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        padding: '10px 9px', border: 0, borderRadius: 'var(--radius-md)', cursor: 'pointer',
        fontSize: 'var(--size-body-s)', fontFamily: 'var(--font-sans)', textAlign: 'left',
        background: active ? 'var(--accent-select-soft)' : hover ? 'var(--surface-muted)' : 'transparent',
        color: active ? 'var(--accent-select)' : hover ? 'var(--text-primary)' : 'var(--text-secondary)',
        transition: 'background var(--duration-fast) ease, color var(--duration-fast) ease', ...style
      }}>
      <span>{children}</span>
      <small style={{ fontSize: 'var(--size-micro)', color: active ? 'var(--accent-select)' : 'var(--text-muted)' }}>{meta}</small>
    </button>
  );
}

/** An asset / search / record row: kind mark, title, meta chips, note. */
export function AssetRow({ mark, title, status, meta = [], note, action, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid', gridTemplateColumns: '44px minmax(0,1fr)', gap: 11, padding: 11,
        border: '1px solid ' + (hover ? 'rgba(109,127,136,.2)' : 'var(--hairline)'), borderRadius: 'var(--radius-lg)',
        background: hover ? 'rgba(255,255,255,.76)' : 'linear-gradient(180deg, rgba(255,255,255,.74), rgba(250,247,241,.58)), var(--surface)',
        cursor: onClick ? 'pointer' : 'default', transition: 'background var(--duration-fast) ease, border-color var(--duration-fast) ease', ...style
      }}>
      <div style={{ display: 'grid', width: 42, height: 42, placeItems: 'center', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-lg)', background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,.92), transparent 42%), linear-gradient(145deg, rgba(233,225,211,.9), rgba(203,191,171,.48))', color: 'rgba(58,51,43,.72)', fontSize: 'var(--size-micro)', fontWeight: 680, letterSpacing: '-.02em' }}>{mark}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: 7 }}>
          <strong style={{ display: 'inline-block', minWidth: 0, overflow: 'hidden', color: 'var(--text-primary)', fontSize: 'var(--size-body-s)', fontWeight: 640, lineHeight: 1.3, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
          {status}
        </div>
        {meta.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {meta.map((m, i) => <span key={i} style={{ display: 'inline-flex', maxWidth: '100%', padding: '3px 6px', border: '1px solid var(--hairline-quiet)', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,.58)', color: 'var(--text-muted)', fontSize: 'var(--size-micro)', lineHeight: 1.2 }}>{m}</span>)}
          </div>
        ) : null}
        {note ? <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--size-micro)', lineHeight: 1.45 }}>{note}</p> : null}
        {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
      </div>
    </div>
  );
}
