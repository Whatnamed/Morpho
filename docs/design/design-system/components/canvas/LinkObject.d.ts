import * as React from 'react';

export interface LinkObjectProps {
  role?: React.ReactNode;
  title?: React.ReactNode;
  url?: React.ReactNode;
  /** Honest fetch state or a one-line description, e.g. "已抓取摘要". */
  description?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function LinkObject(props: LinkObjectProps): JSX.Element;
