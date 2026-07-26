import React from 'react';

/**
 * The 夜航 / Nightrail concept renders the app draws when an image object has
 * no generated asset yet. Copied verbatim from MorphoShapeUtil.renderVisual so
 * mocks and the product show the same artwork.
 */
export function ProductVisual({ variant = 'rail', style }) {
  const svg = { width: '100%', height: '100%', display: 'block', ...style };

  if (variant === 'cmf') {
    return (
      <svg viewBox="0 0 320 210" role="img" aria-label="CMF 小板" style={svg}>
        <rect width="320" height="210" fill="#E7E0D6" />
        <rect x="28" y="28" width="76" height="154" rx="8" fill="#D9D4CA" />
        <rect x="122" y="28" width="76" height="154" rx="8" fill="#A99782" />
        <rect x="216" y="28" width="76" height="154" rx="8" fill="#4D5A4A" />
        <path d="M39 157h54M133 157h54M227 157h54" stroke="#F6E1B6" strokeWidth="8" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === 'scenario' || variant === 'path') {
    return (
      <svg viewBox="0 0 340 230" role="img" aria-label="夜间起身路径" style={svg}>
        <defs>
          <linearGradient id="mv-scenarioWall" x1="0" x2="1">
            <stop stopColor="#E8E0D5" />
            <stop offset="1" stopColor="#F8F2EA" />
          </linearGradient>
        </defs>
        <rect width="340" height="230" fill="url(#mv-scenarioWall)" />
        <rect y="160" width="340" height="70" fill="#D4C9BC" />
        <path d="M34 145h242c18 0 30 10 30 24" fill="none" stroke="#596450" strokeWidth="14" strokeLinecap="round" />
        <path d="M39 145h238c16 0 25 8 25 21" fill="none" stroke="#FFD987" strokeWidth="4" strokeLinecap="round" opacity=".85" />
        <rect x="18" y="91" width="64" height="48" rx="6" fill="#B9AA98" opacity=".72" />
        <rect x="242" y="56" width="54" height="84" rx="6" fill="#CFC5B8" opacity=".92" />
        <circle cx="118" cy="138" r="11" fill="#7C6F60" opacity=".42" />
      </svg>
    );
  }

  if (variant === 'supportIsland') {
    return (
      <svg viewBox="0 0 320 210" role="img" aria-label="家居化支撑岛" style={svg}>
        <rect width="320" height="210" fill="#E9E4DA" />
        <rect x="56" y="74" width="86" height="78" rx="16" fill="#9D8F7D" />
        <rect x="178" y="52" width="72" height="108" rx="20" fill="#646F5E" />
        <path d="M64 86h67M186 66h56" stroke="#FFE1A1" strokeWidth="5" strokeLinecap="round" />
        <path d="M24 168h272" stroke="#C8BCAD" strokeWidth="8" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === 'softGuide') {
    return (
      <svg viewBox="0 0 320 210" role="img" aria-label="软性引导带" style={svg}>
        <rect width="320" height="210" fill="#ECE8E1" />
        <path d="M42 146c52-44 86-30 126-56 28-18 52-34 108-16" fill="none" stroke="#AFA28E" strokeWidth="18" strokeLinecap="round" />
        <path d="M42 146c52-44 86-30 126-56 28-18 52-34 108-16" fill="none" stroke="#F9DFA4" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === 'detail') {
    return (
      <svg viewBox="0 0 320 210" role="img" aria-label="转角连接细节" style={svg}>
        <rect width="320" height="210" fill="#EEE9E0" />
        <path d="M58 132h112c36 0 57-22 57-58v-8" fill="none" stroke="#53604E" strokeWidth="28" strokeLinecap="round" />
        <path d="M58 132h112c36 0 57-22 57-58v-8" fill="none" stroke="#FFE2A0" strokeWidth="6" strokeLinecap="round" />
        <circle cx="206" cy="96" r="26" fill="none" stroke="#8E4C24" strokeWidth="2" strokeDasharray="5 5" />
        <path d="M232 72l38-32" stroke="#8E4C24" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 340 230" role="img" aria-label="柔光轨道产品图" style={svg}>
      <defs>
        <linearGradient id="mv-railWall" x1="0" x2="1">
          <stop stopColor="#E7E0D6" />
          <stop offset="1" stopColor="#F6F0E8" />
        </linearGradient>
        <filter id="mv-softGlow"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <rect width="340" height="230" fill="url(#mv-railWall)" />
      <rect y="170" width="340" height="60" fill="#D2C7BA" />
      <path d="M42 137h166c32 0 54-20 54-52v-26" fill="none" stroke="#52604F" strokeWidth="22" strokeLinecap="round" />
      <path d="M42 137h166c32 0 54-20 54-52v-26" fill="none" stroke="#FFE0A0" strokeWidth="5" strokeLinecap="round" />
      <path d="M42 138h166c32 0 54-20 54-52v-26" fill="none" stroke="#FFD37A" strokeWidth="13" strokeLinecap="round" opacity=".35" filter="url(#mv-softGlow)" />
      <rect x="48" y="146" width="136" height="12" rx="6" fill="#8A7A67" opacity=".32" />
      <circle cx="263" cy="60" r="13" fill="#F9E1AA" opacity=".9" />
    </svg>
  );
}

export const PRODUCT_VISUAL_VARIANTS = ['rail', 'detail', 'scenario', 'cmf', 'supportIsland', 'softGuide'];
