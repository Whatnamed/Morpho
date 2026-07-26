import React from 'react';

/**
 * A conversation message. Assistant turns are plain text on the panel surface;
 * only the user's own words get a bubble.
 */
export function Message({ role = 'assistant', children, style }) {
  if (role === 'user') {
    return (
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', ...style }}>
        <div style={{ maxWidth: '82%', padding: '10px 13px', border: '1px solid rgba(142,76,36,.12)', borderRadius: '17px 17px 5px 17px', background: 'rgba(255,255,255,.54)', boxShadow: '0 8px 22px rgba(54,45,35,.055)', color: 'var(--text-primary)', fontSize: 'var(--size-body)', lineHeight: 'var(--leading-chat)' }}>{children}</div>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 16, maxWidth: '100%', color: 'var(--text-primary)', ...style }}>
      <div style={{ padding: '0 4px', fontSize: 'var(--size-body)', lineHeight: 'var(--leading-chat)' }}>{children}</div>
    </div>
  );
}

/** A paragraph inside a message. Use instead of a bare <p>. */
export function MessageParagraph({ children, style }) {
  return <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: 'var(--size-body)', lineHeight: 'var(--leading-chat)', ...style }}>{children}</p>;
}

/** The three-dot row shown before the first token arrives. */
export function ThinkingRow({ label = 'AI 正在思考', style }) {
  return (
    <div aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 28, color: 'var(--text-muted)', fontSize: 'var(--size-body-s)', ...style }}>
      <style>{'@keyframes morphoThinkingDot{0%,80%,100%{transform:translateY(0);opacity:.28}40%{transform:translateY(-3px);opacity:.72}}'}</style>
      {[0, 140, 280].map(d => <i key={d} style={{ width: 4, height: 4, borderRadius: 999, background: 'currentColor', opacity: .35, animation: 'morphoThinkingDot 1.1s ease-in-out infinite', animationDelay: d + 'ms' }}></i>)}
    </div>
  );
}

/** Numbered source list under an assistant message. */
export function CitationList({ items = [], onOpen, style }) {
  return (
    <div aria-label="来源引用" style={{ display: 'grid', gap: 2, marginTop: 12, ...style }}>
      {items.map((c, i) => (
        <button key={i} type="button" onClick={() => onOpen && onOpen(c, i)}
          style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', alignItems: 'baseline', gap: 9, padding: '7px 2px 7px 9px', border: 0, borderLeft: '2px solid rgba(109,127,136,.34)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'var(--size-body-s)', lineHeight: 1.34, textAlign: 'left', fontFamily: 'var(--font-sans)' }}>
          <span style={{ color: 'rgba(78,68,58,.46)', fontSize: 'var(--size-micro)', fontWeight: 'var(--weight-semibold)', lineHeight: 1.34 }}>{i + 1}</span>
          <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
            {c.origin ? <small style={{ color: 'var(--text-muted)', fontSize: 'var(--size-micro)' }}>{c.origin}</small> : null}
          </span>
        </button>
      ))}
    </div>
  );
}
