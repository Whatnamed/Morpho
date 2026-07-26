import React from 'react';
import { Icon } from '../controls/Icon.jsx';
import { ModeToggle } from '../controls/ModeToggle.jsx';

/**
 * The composer. Not a footer slab: it sits on the same continuous panel
 * surface, with the context strip and the mode disclosure on one row above it.
 */
export function AiComposer({ value = '', onChange, onSend, onStop, busy = false, contextCount = 0, contextTitles = [], hiddenContextCount = 0, modeSummary = '自动执行', turnMode = 'auto', onTurnModeChange, modeOpen = false, onModeToggle, imageSettings, placeholder = '描述你想继续发展的内容…', style }) {
  const [focus, setFocus] = React.useState(false);
  const hasContent = value.trim().length > 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '6px 8px', padding: '4px 14px 14px', ...style }}>
      <div aria-label="当前输入语境" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 5, minHeight: 20 }}>
        <span style={{ flex: '0 0 auto', color: contextCount > 0 ? 'var(--accent-select)' : 'var(--text-muted)', fontSize: 'var(--size-micro)', fontWeight: 620 }}>
          {contextCount > 0 ? `已选 ${contextCount}` : '无选择'}
        </span>
        {contextTitles.map((t, i) => (
          <span key={i} title={typeof t === 'string' ? t : undefined} style={{ maxWidth: 84, overflow: 'hidden', padding: '2px 5px', border: '1px solid var(--hairline-quiet)', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,.44)', color: 'var(--text-secondary)', fontSize: 'var(--size-micro)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
        ))}
        {hiddenContextCount > 0 ? <span style={{ flex: '0 0 auto', padding: '2px 5px', border: '1px solid var(--hairline-quiet)', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,.44)', color: 'var(--text-muted)', fontSize: 'var(--size-micro)' }}>+{hiddenContextCount}</span> : null}
      </div>

      <div style={{ position: 'relative', justifySelf: 'end', fontSize: 'var(--size-micro)' }}>
        <button type="button" aria-expanded={modeOpen} onClick={onModeToggle}
          style={{ minHeight: 20, padding: '0 2px', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', fontWeight: 620, fontSize: 'var(--size-micro)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>{modeSummary}</button>
        {modeOpen ? (
          <div style={{ position: 'absolute', right: 0, bottom: 24, zIndex: 5, width: 'max-content', padding: 5, border: '1px solid var(--hairline)', borderRadius: 'var(--radius-lg)', background: 'rgba(252,251,248,.9)', boxShadow: '0 10px 28px rgba(30,24,18,.09)', backdropFilter: 'blur(18px)' }}>
            <ModeToggle value={turnMode} onChange={onTurnModeChange}
              options={[{ value: 'auto', label: '自动执行' }, { value: 'confirm', label: '先确认' }]} />
          </div>
        ) : null}
      </div>

      {imageSettings ? <div style={{ gridColumn: '1 / -1' }}>{imageSettings}</div> : null}

      <div style={{ gridColumn: '1 / -1', minHeight: 42, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px 5px 12px', border: '1px solid ' + (focus ? 'rgba(109,127,136,.4)' : hasContent ? 'rgba(78,68,58,.16)' : 'var(--hairline)'), borderRadius: 'var(--radius-ai-input)', background: focus ? 'rgba(255,255,255,.46)' : hasContent ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.34)', boxShadow: focus ? '0 0 0 3px rgba(109,127,136,.08)' : 'none', transition: 'border-color var(--duration-fast) ease, background var(--duration-fast) ease, box-shadow var(--duration-fast) ease' }}>
        <textarea rows={1} value={value} placeholder={placeholder} aria-busy={busy}
          onChange={e => onChange && onChange(e.target.value)}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{ flex: 1, minHeight: 26, maxHeight: 104, padding: '3px 0', resize: 'none', border: 0, outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 'var(--size-body)', lineHeight: 1.45, fontFamily: 'var(--font-sans)', overflowY: 'hidden' }} />
        <button type="button" onClick={busy ? onStop : onSend} disabled={!busy && !hasContent}
          aria-label={busy ? '停止当前任务' : '发送'}
          style={{ width: 34, height: 34, flex: '0 0 auto', display: 'grid', placeItems: 'center', border: 0, borderRadius: 'var(--radius-pill)', background: busy ? '#7a3e18' : (!hasContent ? 'rgba(142,76,36,.34)' : 'var(--accent-brand)'), color: !busy && !hasContent ? 'rgba(255,255,255,.78)' : '#fff', cursor: !busy && !hasContent ? 'not-allowed' : 'pointer' }}>
          {busy ? <Icon name="square" size={13} style={{ fill: 'currentColor' }} /> : <Icon name="send" size={15} />}
        </button>
      </div>
    </div>
  );
}

/** The lightweight image-generation settings row, shown only in an image task. */
export function ImageSettings({ fields = [], notes = [], warning, style }) {
  return (
    <div aria-label="图像生成设置" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(76px,.7fr) minmax(70px,.6fr) minmax(82px,.7fr)', gap: 8, marginBottom: 9, padding: 9, border: '1px solid rgba(142,76,36,.16)', borderRadius: 'var(--radius-object)', background: 'rgba(255,252,247,.48)', ...style }}>
      {fields.map((field, i) => (
        <label key={i} style={{ minWidth: 0, display: 'grid', gap: 4, color: 'var(--text-muted)', fontSize: 'var(--size-micro)' }}>
          <span style={{ fontWeight: 620, letterSpacing: '.02em' }}>{field.label}</span>
          <select value={field.value} disabled={field.disabled} onChange={e => field.onChange && field.onChange(e.target.value)}
            style={{ minWidth: 0, width: '100%', height: 30, border: '1px solid rgba(78,68,58,.16)', borderRadius: 7, background: 'var(--surface-raised)', color: field.disabled ? 'var(--text-muted)' : 'var(--text-primary)', fontSize: 'var(--size-label)', fontFamily: 'var(--font-sans)' }}>
            {field.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      ))}
      {notes.map((n, i) => (
        <div key={i} style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6, color: 'var(--text-muted)', fontSize: 'var(--size-micro)' }}>{n}</div>
      ))}
      {warning ? <div style={{ gridColumn: '1 / -1', padding: '7px 8px', border: '1px solid rgba(154,81,39,.24)', borderRadius: 'var(--radius-md)', background: 'rgba(255,238,220,.74)', color: '#7a3e18', fontSize: 'var(--size-micro)', lineHeight: 1.45 }}>{warning}</div> : null}
    </div>
  );
}
