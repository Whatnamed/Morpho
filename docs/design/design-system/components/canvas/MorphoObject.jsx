import React from 'react';

/**
 * Absolute-positioned wrapper carrying Morpho's canvas object states:
 * selection ring + halo, design-trace highlight, detail reference highlight,
 * quieted opacity for eliminated directions, and the 后续默认参考 badge.
 */
export function MorphoObject({ left, top, width, selected = false, designTrace = false, referenceHighlight = false, quiet = false, defaultReference = false, radius = 'var(--radius-object)', onSelect, ariaLabel, style, children }) {
  const shadow = designTrace ? 'var(--shadow-design-trace)'
    : (selected || referenceHighlight) ? 'var(--shadow-selected)' : 'none';
  return (
    <article tabIndex={0} aria-label={ariaLabel} onClick={onSelect}
      style={{
        position: 'absolute', left, top, width, cursor: 'pointer', outline: 'none',
        opacity: quiet ? 0.68 : 1,
        transition: 'box-shadow var(--duration-ui) var(--ease-out), filter var(--duration-ui) var(--ease-out), opacity 160ms ease',
        ...style
      }}>
      <div style={{ position: 'relative', borderRadius: radius, boxShadow: shadow, transition: 'box-shadow var(--duration-ui) var(--ease-out)' }}>
        {defaultReference ? (
          <span style={{ position: 'absolute', zIndex: 2, top: 8, left: 10, padding: '5px 7px', border: '1px solid rgba(109,127,136,.26)', borderRadius: 'var(--radius-sm)', background: 'rgba(252,251,248,.9)', color: 'var(--accent-select)', fontSize: 'var(--size-micro)', fontWeight: 'var(--weight-semibold)', boxShadow: '0 4px 14px rgba(30,24,18,.08), 0 0 0 1px rgba(109,127,136,.28)' }}>后续默认参考</span>
        ) : null}
        {children}
      </div>
    </article>
  );
}
