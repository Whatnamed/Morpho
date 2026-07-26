import * as React from 'react';

export interface StageRegionProps {
  left: number;
  top: number;
  /** Minimum 280 × 220 in the editor. */
  width?: number;
  height?: number;
  colorKey?: 'warmSand' | 'mistBlue' | 'sage' | 'violetGray' | 'clay' | 'warmGray';
  /** 资料与研究 · 设计定义 · 方向与视觉 · 交付整理 */
  title?: React.ReactNode;
  /** Percentage of the preset fill mixed into transparent. Default 16. */
  fillOpacity?: number;
  backgroundVisible?: boolean;
  borderStyle?: 'none' | 'solid' | 'dashed';
  /** Locked regions cannot be dragged or resized; the title shows a lock. */
  locked?: boolean;
  style?: React.CSSProperties;
}

export declare const STAGE_REGION_COLORS: Record<string, { label: string; fill: string; border: string; title: string }>;
export declare function StageRegion(props: StageRegionProps): JSX.Element;
