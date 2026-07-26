import * as React from 'react';

export interface CanvasSurfaceProps {
  camera?: { x: number; y: number; scale: number };
  worldWidth?: number;
  worldHeight?: number;
  /** World-space dot grid. The production canvas draws it through tldraw. */
  dots?: boolean;
  dotSize?: number;
  onBackgroundClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare function CanvasSurface(props: CanvasSurfaceProps): JSX.Element;
