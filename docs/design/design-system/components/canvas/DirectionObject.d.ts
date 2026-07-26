import * as React from 'react';

export interface DirectionObjectProps {
  /** 待预览方向 · 主方向 · 备选方向 · 已淘汰方向 · 待复核方向 */
  role?: React.ReactNode;
  title?: React.ReactNode;
  /** One sentence of strategy. */
  summary?: React.ReactNode;
  /** e.g. "关键词：连续支撑 / 低位柔光 / 低施工" */
  keywords?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function DirectionObject(props: DirectionObjectProps): JSX.Element;
