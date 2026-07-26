import * as React from 'react';

export interface ImageCollectionObjectProps {
  role?: React.ReactNode;
  title?: React.ReactNode;
  summary?: React.ReactNode;
  /** Member count, rendered as "成员：N 张". */
  count?: number;
  style?: React.CSSProperties;
}

export declare function ImageCollectionObject(props: ImageCollectionObjectProps): JSX.Element;
