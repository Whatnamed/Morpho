import React from 'react';

/**
 * The floating toolbar that follows a canvas selection. Icon-first, grouped,
 * with a secondary group for destructive and rare actions.
 */
export function SelectionToolbar({ children, stage = false, style }) {
  return (
    <div role="toolbar" aria-label={stage ? '分区操作' : '选中操作'} style={{
      position: 'absolute', zIndex: 42, boxSizing: 'border-box',
      maxWidth: 'min(520px, calc(100vw - 64px))', minHeight: 40,
      display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 4,
      overflow: 'visible', padding: 4, border: '1px solid var(--morpho-glass-border)',
      borderRadius: 'var(--radius-lg)', background: 'var(--morpho-glass-bg)',
      boxShadow: 'var(--shadow-toolbar)', backdropFilter: 'var(--blur-toolbar)',
      WebkitBackdropFilter: 'var(--blur-toolbar)', transform: 'translateX(-50%)', ...style
    }}>{children}</div>
  );
}

/** A group of toolbar controls; `secondary` quiets them one step. */
export function ToolbarGroupInline({ secondary = false, children, style }) {
  return <div data-secondary={secondary ? 'true' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto', ...style }}>{children}</div>;
}

/** Hairline divider between toolbar groups. */
export function ToolbarDivider({ style }) {
  return <div style={{ width: 1, height: 18, flex: '0 0 auto', margin: '0 2px', background: 'var(--morpho-glass-border)', ...style }}></div>;
}

/** A toolbar control. Icon-only by default, with a tooltip below. */
export function CanvasIconButton({ icon, label, children, secondary = false, active = false, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  const iconOnly = !children;
  return (
    <button type="button" onClick={onClick} aria-label={label} data-tooltip={iconOnly ? label : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', display: 'inline-flex', flex: '0 0 auto', alignItems: 'center', justifyContent: 'center',
        gap: 4, minHeight: 30, width: iconOnly ? 30 : undefined, minWidth: iconOnly ? 30 : undefined,
        padding: iconOnly ? 0 : '0 8px', border: 0, borderRadius: iconOnly ? 'var(--radius-md)' : 'var(--radius-icon-button)',
        background: hover || active ? 'var(--surface-muted)' : 'transparent',
        color: hover || active ? 'var(--text-primary)' : secondary ? 'var(--text-muted)' : 'var(--text-secondary)',
        cursor: 'pointer', fontSize: 'var(--size-label)', fontWeight: 'var(--weight-mid)', lineHeight: 1,
        whiteSpace: 'nowrap', fontFamily: 'var(--font-sans)',
        transition: 'background var(--duration-fast) ease, color var(--duration-fast) ease', ...style
      }}>
      {icon}{children}
      {iconOnly && hover ? (
        <span style={{ position: 'absolute', zIndex: 4, top: 'calc(100% + 8px)', left: '50%', maxWidth: 156, padding: '5px 7px', borderRadius: 6, background: 'rgba(49,42,35,.9)', color: '#fff', fontSize: 'var(--size-micro)', lineHeight: 1.2, transform: 'translateX(-50%)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{label}</span>
      ) : null}
    </button>
  );
}

/** A swatch trigger for the stage-region colour control. */
export function StageColorSwatch({ color, selected = false, onClick, label, style }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      style={{ position: 'relative', display: 'grid', width: 28, height: 28, placeItems: 'center', padding: 0, border: '1px solid ' + (selected ? 'rgba(78,68,58,.2)' : 'transparent'), borderRadius: 7, background: selected ? 'var(--surface-muted)' : 'transparent', cursor: 'pointer', ...style }}>
      <span style={{ width: 14, height: 14, borderRadius: 999, background: color, boxShadow: 'inset 0 0 0 1px rgba(78,68,58,.12)' }}></span>
    </button>
  );
}

/** The popover a toolbar control opens (colour, border, opacity). */
export function ToolbarPopover({ children, style }) {
  return (
    <div style={{ position: 'absolute', zIndex: 3, top: 'calc(100% + 8px)', left: '50%', display: 'flex', alignItems: 'center', gap: 6, padding: 7, border: '1px solid var(--morpho-glass-border)', borderRadius: 'var(--radius-object)', background: 'rgba(252,251,248,.98)', boxShadow: 'var(--shadow-popover)', transform: 'translateX(-50%)', backdropFilter: 'blur(14px)', ...style }}>{children}</div>
  );
}
