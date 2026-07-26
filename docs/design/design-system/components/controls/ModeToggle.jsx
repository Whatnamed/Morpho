import React from 'react';

/** Segmented control for the composer's execution strategy. */
export function ModeToggle({ value, options = [], onChange, label = '执行策略', style }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: 2, border: '1px solid var(--hairline)', borderRadius: 'var(--radius-object)', background: 'rgba(255,255,255,.38)', ...style }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={active} onClick={() => onChange && onChange(o.value)}
            style={{
              padding: '4px 7px', border: 0, borderRadius: 'var(--radius-control)',
              background: active ? '#fff' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: active ? '0 4px 12px rgba(30,24,18,.06)' : 'none',
              cursor: 'pointer', fontSize: 'var(--size-micro)', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap'
            }}>{o.label}</button>
        );
      })}
    </div>
  );
}
