import * as React from 'react';

export interface PendingImageObjectProps {
  /** Short state word, e.g. 生成中. */
  label?: React.ReactNode;
  /** What is being generated, in the user's own words. */
  title?: React.ReactNode;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}

export declare function PendingImageObject(props: PendingImageObjectProps): JSX.Element;
