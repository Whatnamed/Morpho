import React from 'react';

const TONES = {
  confirm: { borderColor: 'rgba(109,127,136,.16)', background: 'rgba(255,255,255,.62)', title: 'var(--text-primary)' },
  failure: { borderColor: 'rgba(166,69,58,.16)', background: 'rgba(255,248,246,.72)', title: 'var(--danger)' },
  note: { borderColor: 'rgba(109,127,136,.16)', background: 'rgba(238,241,241,.64)', title: 'var(--text-primary)' }
};

/**
 * The three inline cards the conversation can contain: a confirmation, a
 * failure with recovery, and a context note. All are local to the chat.
 */
export function InlineCard({ tone = 'confirm', title, meta, children, actions, onDismiss, style }) {
  const t = TONES[tone];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: tone === 'note' ? 10 : 14, padding: tone === 'note' ? '8px 9px' : 13, border: '1px solid ' + t.borderColor, borderRadius: tone === 'note' ? 'var(--radius-object)' : 14, background: t.background, ...style }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <strong style={{ display: 'block', marginBottom: tone === 'note' ? 3 : 7, color: t.title, fontSize: tone === 'note' ? 'var(--size-label)' : 'var(--size-body-s)' }}>{title}</strong> : null}
        <div style={{ margin: 0, color: 'var(--text-secondary)', fontSize: tone === 'note' ? 'var(--size-label)' : 'var(--size-body-s)', lineHeight: tone === 'note' ? 1.45 : 1.55 }}>{children}</div>
        {meta ? <span style={{ display: 'block', marginTop: 8, color: 'var(--text-muted)', fontSize: 'var(--size-label)' }}>{meta}</span> : null}
        {actions ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>{actions}</div> : null}
      </div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="关闭"
          style={{ width: 22, height: 22, display: 'grid', flex: '0 0 auto', placeItems: 'center', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
      ) : null}
    </div>
  );
}

/** The reviewable proposal card in the conversation, before anything is saved. */
export function ProposalCard({ title, state = '待确认', meta = [], help, sections = [], citations = [], actions, style }) {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 14, padding: 14, border: '1px solid var(--hairline-quiet)', borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,.5)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 'var(--size-body)', fontWeight: 680, lineHeight: 1.4 }}>{title}</strong>
          {meta.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, color: 'var(--text-muted)', fontSize: 'var(--size-label)' }}>
              {meta.map((m, i) => <span key={i}>{m}</span>)}
            </div>
          ) : null}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 7px', border: '1px solid var(--hairline-quiet)', borderRadius: 'var(--radius-pill)', background: 'rgba(240,236,230,.72)', color: 'var(--text-secondary)', fontSize: 'var(--size-label)', whiteSpace: 'nowrap' }}>{state}</span>
      </div>
      {help ? <p style={{ margin: 0, maxWidth: '66ch', color: 'var(--text-secondary)', fontSize: 'var(--size-body)', lineHeight: 1.7 }}>{help}</p> : null}
      {sections.map((s, i) => (
        <div key={i} style={{ display: 'grid', gap: 5, paddingTop: i === 0 ? 0 : 12, borderTop: i === 0 ? 0 : '1px solid var(--hairline-quiet)' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--size-label)', fontWeight: 620, lineHeight: 1.4 }}>{s.label}</span>
          <ul style={{ display: 'grid', gap: 7, margin: 0, padding: 0, listStyle: 'none' }}>
            {s.items.map((it, j) => (
              <li key={j} style={{ position: 'relative', paddingLeft: 14, color: 'var(--text-primary)', fontSize: 'var(--size-body-l)', lineHeight: 1.65 }}>
                <span aria-hidden="true" style={{ position: 'absolute', top: '0.78em', left: 1, width: 4, height: 4, borderRadius: 999, background: 'rgba(109,127,136,.58)' }}></span>{it}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {citations.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {citations.map((c, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 8px', border: '1px solid var(--border-subtle)', borderRadius: 7, background: 'rgba(250,247,241,.62)', color: 'var(--text-secondary)', fontSize: 'var(--size-label)' }}>{c}</span>)}
        </div>
      ) : null}
      {actions ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{actions}</div> : null}
    </div>
  );
}
