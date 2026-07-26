import React from 'react';
import { Icon } from '../controls/Icon.jsx';

/**
 * The continuous AI conversation surface. Frosted glass anchored to the lower
 * right, no title bar: a small handle, a masked scroll shell, and the composer
 * on the same continuous surface. It overlaps the canvas and never resizes it.
 */
export function AiPanel({ open = true, onToggle, footer, children, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <section aria-label="AI 对话" style={{
      position: 'absolute', zIndex: 40, top: 'auto', right: 'var(--ai-panel-right)', bottom: 'var(--ai-panel-bottom)',
      width: 'var(--ai-panel-width)', height: 'var(--ai-panel-height)', minHeight: 'var(--ai-panel-min-height)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      border: '1px solid var(--morpho-glass-border)', borderRadius: 'var(--radius-ai-panel)',
      background: 'var(--morpho-glass-bg)', boxShadow: 'var(--shadow-ai-panel)',
      backdropFilter: 'var(--morpho-glass-blur)', WebkitBackdropFilter: 'var(--morpho-glass-blur)',
      userSelect: 'text',
      opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden', pointerEvents: open ? 'auto' : 'none',
      transform: open ? 'none' : 'translateY(10px) scale(.99)',
      transition: 'opacity var(--duration-ui) var(--ease-out), transform var(--duration-ui) var(--ease-out), visibility var(--duration-ui)',
      ...style
    }}>
      <div style={{ minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 6px' }}>
        <div aria-hidden="true" style={{ position: 'relative', width: 30, height: 30 }}>
          <span style={{ position: 'absolute', top: 14, left: 3, width: 24, height: 1, background: 'rgba(78,68,58,.18)' }}></span>
        </div>
        <button type="button" onClick={onToggle} aria-label="收起 AI 面板"
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 'var(--radius-icon-button)', background: hover ? 'rgba(78,68,58,.06)' : 'transparent', color: hover ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}>
          <Icon name="chevron-left" />
        </button>
      </div>
      <div style={{
        position: 'relative', flex: 1, minHeight: 0,
        WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 calc(100% - 96px), rgba(0,0,0,.62) calc(100% - 44px), rgba(0,0,0,.22) calc(100% - 16px), transparent 100%)',
        maskImage: 'linear-gradient(to bottom, #000 0%, #000 calc(100% - 96px), rgba(0,0,0,.62) calc(100% - 44px), rgba(0,0,0,.22) calc(100% - 16px), transparent 100%)'
      }}>
        <div style={{ height: '100%', overflow: 'auto', padding: '4px 18px 88px', scrollbarWidth: 'none' }}>{children}</div>
      </div>
      {footer}
    </section>
  );
}

/** The collapsed entry: a 42px round mark in the lower-right corner. */
export function AiToggle({ open = true, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onClick} aria-label={open ? '收起 AI' : '打开 AI'}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute', zIndex: 43, right: 28, bottom: 28, width: 42, height: 42,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        border: '1px solid var(--morpho-glass-border)', borderRadius: 'var(--radius-pill)',
        background: hover ? 'var(--surface-raised)' : 'rgba(252,251,248,.94)', color: 'var(--text-primary)',
        boxShadow: 'var(--shadow-panel)', cursor: 'pointer',
        transform: hover ? 'translateY(-1px)' : 'none',
        transition: 'transform var(--duration-ui) var(--ease-out), background var(--duration-fast) ease', ...style
      }}>
      <span aria-hidden="true" style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: '50%', border: '1px solid var(--hairline)', background: 'rgba(255,255,255,.58)', color: 'var(--text-primary)', fontSize: 'var(--size-body)', fontWeight: 680 }}>M</span>
    </button>
  );
}

/** The task-status pill left of the toggle. */
export function AiQueue({ label = '空闲', busy = false, children, open = false, onToggle, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div style={{ position: 'absolute', zIndex: 43, right: 78, bottom: 28, ...style }}>
      <button type="button" aria-expanded={open} onClick={onToggle}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ height: 42, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 12px', border: '1px solid ' + (hover || open ? 'rgba(78,68,58,.14)' : 'var(--morpho-glass-border)'), borderRadius: 'var(--radius-pill)', background: hover || open ? 'rgba(252,251,248,.96)' : 'rgba(252,251,248,.92)', color: 'var(--text-secondary)', boxShadow: 'var(--shadow-panel)', cursor: 'pointer', fontSize: 'var(--size-label)', fontFamily: 'var(--font-sans)' }}>
        <style>{'@keyframes morphoQueuePulse{0%{box-shadow:0 0 0 0 rgba(142,76,36,.35)}70%{box-shadow:0 0 0 6px rgba(142,76,36,0)}100%{box-shadow:0 0 0 0 rgba(142,76,36,0)}}'}</style>
        <span>状态</span>
        <strong style={{ position: 'relative', paddingLeft: busy ? 10 : 0, color: busy ? 'var(--accent-brand)' : 'var(--text-primary)', fontSize: 'var(--size-label)' }}>
          {busy ? <span style={{ position: 'absolute', top: '50%', left: 0, width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-brand)', transform: 'translateY(-50%)', animation: 'morphoQueuePulse 1.4s ease-out infinite' }}></span> : null}
          {label}
        </strong>
      </button>
      {open ? (
        <div role="status" style={{ position: 'absolute', right: 0, bottom: 50, width: 230, display: 'grid', gap: 8, padding: 11, border: '1px solid var(--morpho-glass-border)', borderRadius: 14, background: 'rgba(252,251,248,.96)', boxShadow: 'var(--shadow-popover)', color: 'var(--text-secondary)', fontSize: 'var(--size-body-s)', backdropFilter: 'blur(18px)' }}>{children}</div>
      ) : null}
    </div>
  );
}
