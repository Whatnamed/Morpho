import React from 'react';

/**
 * The workspace ground. In production this is a tldraw canvas: a solid warm
 * fill, world-space dots that follow pan and zoom, and two soft washes over it.
 * Everything else floats above.
 */
export function CanvasSurface({ camera = { x: 0, y: 0, scale: 1 }, worldWidth = 2400, worldHeight = 1600, dots = true, dotSize = 24, onBackgroundClick, style, children }) {
  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget || e.target.dataset.canvasGround) onBackgroundClick && onBackgroundClick(e); }}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none', background: 'var(--canvas-wash), var(--canvas)', ...style }}
    >
      <div
        data-canvas-ground="true"
        style={{
          position: 'absolute', left: 0, top: 0, width: worldWidth, height: worldHeight,
          transformOrigin: '0 0', willChange: 'transform',
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          backgroundImage: dots ? 'radial-gradient(var(--canvas-grid-dot) 1px, transparent 1.2px)' : 'none',
          backgroundSize: `${dotSize}px ${dotSize}px`
        }}
      >{children}</div>
    </div>
  );
}
