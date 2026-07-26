import * as React from 'react';

export interface DeliveryObjectProps {
  role?: React.ReactNode;
  /** e.g. "A1 展板 · 核心方案" */
  title?: React.ReactNode;
  /** A real signal line: "章节：4 · 引用：6" or "开放待补：2". Never a percentage. */
  note?: React.ReactNode;
  /** Stable reference to an upstream image; defaults to the rail visual. */
  preview?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function DeliveryObject(props: DeliveryObjectProps): JSX.Element;
