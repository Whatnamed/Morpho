import React from 'react';
import { Icon } from '../controls/Icon.jsx';

/**
 * The collapsible "what the agent is doing" trace. It replaces the old
 * Operation progress card: business-level activity only, never chain-of-thought.
 */
export function AgentProcess({ title, open = false, streaming = false, onToggle, children, style }) {
  return (
    <section aria-label="Agent 过程" style={{ margin: '1px 0 10px', maxWidth: '100%', color: 'var(--text-secondary)', ...style }}>
      <style>{'@keyframes morphoAgentShimmer{to{background-position:-115% 0}}'}</style>
      <button type="button" aria-expanded={open} onClick={onToggle}
        style={{ display: 'inline-flex', maxWidth: '100%', alignItems: 'center', gap: 5, minHeight: 27, padding: 0, border: 0, borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--size-body-s)', lineHeight: '18px', textAlign: 'left', fontFamily: 'var(--font-sans)' }}>
        <span style={{ position: 'relative', display: 'inline-block', minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
          <span>{title}</span>
          {streaming ? (
            <span aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', color: 'transparent', backgroundImage: 'linear-gradient(100deg, transparent 18%, color-mix(in srgb, var(--text-secondary) 72%, transparent) 46%, transparent 72%)', backgroundPosition: '115% 0', backgroundSize: '240% 100%', backgroundRepeat: 'no-repeat', WebkitBackgroundClip: 'text', backgroundClip: 'text', animation: 'morphoAgentShimmer 1.7s linear infinite' }}>{title}</span>
          ) : null}
        </span>
        <Icon name="chevron-down" size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms cubic-bezier(.32,.72,0,1)' }} />
      </button>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 200ms cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          <div style={{ position: 'relative', marginTop: 2, maxWidth: '100%', opacity: open ? 1 : 0, transform: open ? 'translateY(0)' : 'translateY(-4px)', filter: open ? 'blur(0)' : 'blur(1.5px)', transition: 'opacity 190ms ease, transform 200ms cubic-bezier(.32,.72,0,1), filter 190ms ease' }}>
            <div style={{ maxHeight: 'clamp(220px, 34vh, 320px)', overflowY: 'auto', overflowX: 'hidden', padding: '7px 8px 5px 0' }}>
              <div style={{ display: 'grid', gap: 9, minWidth: 0, paddingLeft: 3 }}>{children}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const ACTIVITY_ICON = { webSearch: 'search', fileRead: 'file-text', contextRead: 'file-text', imageGeneration: 'image', tool: 'wrench' };

/** One activity line inside the trace. */
export function AgentActivity({ kind = 'tool', label, detail, state = 'done', style }) {
  const failed = state === 'failed';
  return (
    <div data-state={state} style={{ display: 'grid', gridTemplateColumns: '13px minmax(0,1fr)', columnGap: 7, alignItems: 'start', maxWidth: '100%', minWidth: 0, color: failed ? 'var(--danger)' : 'var(--text-muted)', fontSize: 'var(--size-body-s)', lineHeight: '18px', ...style }}>
      <Icon name={ACTIVITY_ICON[kind] || 'wrench'} size={13} style={{ marginTop: 2 }} />
      <div style={{ display: 'grid', minWidth: 0, gap: 1 }}>
        <span style={{ position: 'relative', display: 'inline-block', minWidth: 0, overflowWrap: 'anywhere' }}>
          <span>{label}</span>
          {state === 'running' ? (
            <span aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', color: 'transparent', backgroundImage: 'linear-gradient(100deg, transparent 18%, color-mix(in srgb, var(--text-secondary) 72%, transparent) 46%, transparent 72%)', backgroundPosition: '115% 0', backgroundSize: '240% 100%', backgroundRepeat: 'no-repeat', WebkitBackgroundClip: 'text', backgroundClip: 'text', animation: 'morphoAgentShimmer 1.7s linear infinite' }}>{label}</span>
          ) : null}
        </span>
        {detail ? <small style={{ color: failed ? 'var(--danger)' : 'var(--text-muted)', fontSize: 'var(--size-label)', lineHeight: '17px', overflowWrap: 'anywhere' }}>{detail}</small> : null}
      </div>
    </div>
  );
}

/** A commentary paragraph inside the trace. */
export function AgentNote({ children, style }) {
  return <div style={{ maxWidth: '100%', minWidth: 0, color: 'color-mix(in srgb, var(--text-secondary) 88%, var(--text-muted))', fontSize: '12.5px', lineHeight: '19px', overflowWrap: 'anywhere', ...style }}>{children}</div>;
}
