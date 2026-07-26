import React from 'react';
import { Icon } from '../controls/Icon.jsx';

export const STAGE_REGION_COLORS = {
  warmSand: { label: '暖米色', fill: 'var(--stage-warm-sand-fill)', border: 'var(--stage-warm-sand-border)', title: 'var(--stage-warm-sand-title)' },
  mistBlue: { label: '雾蓝', fill: 'var(--stage-mist-blue-fill)', border: 'var(--stage-mist-blue-border)', title: 'var(--stage-mist-blue-title)' },
  sage: { label: '浅灰绿', fill: 'var(--stage-sage-fill)', border: 'var(--stage-sage-border)', title: 'var(--stage-sage-title)' },
  violetGray: { label: '淡紫灰', fill: 'var(--stage-violet-gray-fill)', border: 'var(--stage-violet-gray-border)', title: 'var(--stage-violet-gray-title)' },
  clay: { label: '浅陶色', fill: 'var(--stage-clay-fill)', border: 'var(--stage-clay-border)', title: 'var(--stage-clay-title)' },
  warmGray: { label: '中性暖灰', fill: 'var(--stage-warm-gray-fill)', border: 'var(--stage-warm-gray-border)', title: 'var(--stage-warm-gray-title)' }
};

/**
 * A stage landmark on the canvas: a tinted wash with a small title.
 * Not a frame, not a container — objects are not parented to it.
 */
export function StageRegion({ left, top, width = 400, height = 320, colorKey = 'warmSand', title, fillOpacity = 16, backgroundVisible = true, borderStyle = 'solid', locked = false, style }) {
  const color = STAGE_REGION_COLORS[colorKey] || STAGE_REGION_COLORS.warmSand;
  const fill = backgroundVisible ? `color-mix(in srgb, ${color.fill} ${fillOpacity}%, transparent)` : 'transparent';
  return (
    <div style={{ position: 'absolute', left, top, width, height, borderRadius: 'var(--radius-rail)', overflow: 'hidden', boxSizing: 'border-box', ...style }}>
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, borderRadius: 'var(--radius-rail)',
        border: '1px ' + (borderStyle === 'dashed' ? 'dashed' : 'solid') + ' ' + (borderStyle === 'none' ? 'transparent' : color.border),
        background: fill,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.72), 0 0 0 1px rgba(78,68,58,.04), 0 10px 28px rgba(54,45,35,.04)',
        pointerEvents: 'none'
      }}></div>
      <div style={{ position: 'absolute', top: 12, left: 14, zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 6, color: color.title, fontSize: 'var(--size-body-s)', fontWeight: 'var(--weight-heavy)', letterSpacing: 'var(--track-label)', pointerEvents: 'none', userSelect: 'none' }}>
        <span>{title}</span>
        {locked ? <Icon name="lock-keyhole" size={11} /> : null}
      </div>
    </div>
  );
}
