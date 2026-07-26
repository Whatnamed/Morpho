import * as React from 'react';

export interface ProductVisualProps {
  /** rail = 柔光轨道主视觉 · detail = 转角连接 · scenario/path = 夜间路径 ·
   *  cmf = CMF 小板 · supportIsland = 家具化支撑岛 · softGuide = 软性引导带 */
  variant?: 'rail' | 'detail' | 'scenario' | 'path' | 'cmf' | 'supportIsland' | 'softGuide';
  style?: React.CSSProperties;
}

export declare function ProductVisual(props: ProductVisualProps): JSX.Element;
export declare const PRODUCT_VISUAL_VARIANTS: string[];
