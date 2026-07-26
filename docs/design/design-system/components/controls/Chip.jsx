import React from 'react';

/**
 * The small pill controls: drawer filters, AI suggestions, row status marks.
 * Filter and suggestion chips share one 10px shell; only the radius differs by
 * context (4px in drawers, full pill inside the AI panel).
 */
export function Chip({ kind = 'filter', active = false, pill = false, children, onClick, title, style }) {
  const [hover, setHover] = React.useState(false);
  if (kind === 'status') {
    return (
      <span title={title} style={{ flex: '0 0 auto', padding: '2px 6px', border: '1px solid rgba(117,83,49,.12)', borderRadius: 'var(--radius-pill)', background: 'rgba(241,235,225,.78)', color: 'var(--text-secondary)', fontSize: 'var(--size-nano)', fontWeight: 'var(--weight-semibold)', ...style }}>{children}</span>
    );
  }
  const on = active || hover;
  return (
    <button type="button" onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        padding: kind === 'suggestion' ? '7px 9px' : '7px 8px',
        border: '1px solid ' + (on ? 'rgba(109,127,136,.22)' : 'var(--border-subtle)'),
        borderRadius: pill ? 'var(--radius-pill)' : 'var(--radius-sm)',
        background: on ? 'rgba(228,234,235,.72)' : (pill ? 'rgba(255,255,255,.42)' : 'transparent'),
        color: on ? 'var(--accent-select)' : 'var(--text-secondary)',
        cursor: 'pointer', fontSize: 'var(--size-micro)', lineHeight: 1, fontFamily: 'var(--font-sans)',
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        transition: 'background var(--duration-fast) ease, border-color var(--duration-fast) ease, color var(--duration-fast) ease',
        ...style
      }}>{children}</button>
  );
}
