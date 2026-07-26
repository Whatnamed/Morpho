import React from 'react';

const DOTS = [
  { top: '22%', left: '18%', delay: '0s' },
  { top: '38%', left: '68%', delay: '-0.5s' },
  { top: '67%', left: '38%', delay: '-1.2s' },
  { top: '72%', left: '78%', delay: '-1.7s' },
  { top: '13%', left: '48%', delay: '-2s' }
];

/** Page-space placeholder while an image generation Operation runs. */
export function PendingImageObject({ label = '生成中', title, width = 320, height = 214, style }) {
  return (
    <div style={{ position: 'relative', boxSizing: 'border-box', width, height, display: 'grid', alignContent: 'end', justifyItems: 'start', padding: 16, overflow: 'hidden', border: '1px solid rgba(78,68,58,.12)', borderRadius: 'var(--radius-object)', background: 'linear-gradient(145deg, rgba(246,244,239,.98), rgba(231,229,222,.93))', boxShadow: '0 8px 22px rgba(30,24,18,.06)', color: 'var(--text-secondary)', isolation: 'isolate', textAlign: 'left', ...style }}>
      <style>{'@keyframes morphoPendingShimmer{0%,18%{transform:translateX(-42%)}72%,100%{transform:translateX(42%)}}@keyframes morphoPendingPulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.35)}}'}</style>
      <div aria-hidden="true" style={{ position: 'absolute', inset: '-35%', zIndex: -1, background: 'linear-gradient(112deg, transparent 24%, rgba(255,255,255,.08) 38%, rgba(255,255,255,.55) 48%, rgba(255,255,255,.1) 59%, transparent 72%)', transform: 'translateX(-42%)', animation: 'morphoPendingShimmer 2.6s ease-in-out infinite' }}></div>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: -1, overflow: 'hidden', opacity: 0.55 }}>
        {DOTS.map((d, i) => <i key={i} style={{ position: 'absolute', top: d.top, left: d.left, width: 4, height: 4, borderRadius: '50%', background: 'rgba(100,96,88,.18)', animation: 'morphoPendingPulse 2.4s ease-in-out infinite', animationDelay: d.delay }}></i>)}
      </div>
      <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--size-label)' }}>{label}</span>
        <strong style={{ maxWidth: '100%', overflow: 'hidden', color: 'var(--text-primary)', fontSize: 'var(--size-body)', fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
      </div>
    </div>
  );
}
