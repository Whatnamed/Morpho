import * as React from 'react';
import * as Lucide from 'lucide-react';

/**
 * Morpho's icon primitive — repo edition.
 * Same API as the design-system copy (kebab-case `name`, px `size`), but the
 * glyph is resolved from lucide-react instead of the UMD `window.lucide` build,
 * so it renders during SSR. Next.js tree-shakes lucide-react through
 * `experimental.optimizePackageImports` (on by default since 14.1).
 */
function toPascal(name) {
  return name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
}

export function Icon({ name, size = 16, strokeWidth = 2, style, ...rest }) {
  const Glyph = Lucide[toPascal(name)] || Lucide[name];
  if (!Glyph) {
    return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, ...style }} />;
  }
  return (
    <Glyph width={size} height={size} strokeWidth={strokeWidth} aria-hidden="true"
      style={{ flex: '0 0 auto', display: 'block', ...style }} {...rest} />
  );
}

/** Every Lucide glyph the Morpho workspace imports, grouped by surface. */
export const MORPHO_ICONS = {
  rail: ['plus', 'map', 'boxes', 'eye-off', 'notebook-text', 'search'],
  topControls: ['search', 'square-dashed-mouse-pointer', 'import', 'package-open', 'archive', 'download', 'chevron-down', 'home'],
  aiPanel: ['chevron-left', 'chevron-down', 'send', 'square'],
  agentProcess: ['chevron-down', 'search', 'file-text', 'image', 'wrench'],
  detail: ['book-open'],
  selectionToolbar: [
    'badge-check', 'book-open', 'circle-off', 'clipboard-paste', 'copy', 'eye-off', 'file-up', 'file-x-2',
    'flag', 'git-branch', 'git-branch-plus', 'git-compare', 'git-merge', 'info', 'list-checks',
    'lock-keyhole', 'lock-keyhole-open', 'message-square-text', 'more-horizontal', 'package-open',
    'pen-line', 'pin', 'pin-off', 'rotate-ccw', 'scan', 'scan-search', 'sparkles', 'trash-2', 'unlink', 'x'
  ],
  stageToolbar: ['droplets', 'eye-off', 'lock-keyhole', 'lock-keyhole-open', 'paint-bucket', 'rotate-ccw', 'scan'],
  delivery: ['file-plus-2', 'grip-vertical', 'package-open', 'plus', 'refresh-cw', 'sparkles', 'trash-2', 'x', 'download', 'file-warning', 'package-check'],
  documentReader: ['chevron-down', 'chevron-up', 'search', 'x'],
  starter: ['message-circle', 'upload'],
  auth: ['arrow-right', 'lock-keyhole']
};
