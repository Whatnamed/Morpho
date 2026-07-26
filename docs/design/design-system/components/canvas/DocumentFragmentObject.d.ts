import * as React from 'react';

export interface DocumentFragmentObjectProps {
  role?: React.ReactNode;
  title?: React.ReactNode;
  /** Source file, excerpt body, source state — one short paragraph each. */
  lines?: React.ReactNode[];
  style?: React.CSSProperties;
}

export declare function DocumentFragmentObject(props: DocumentFragmentObjectProps): JSX.Element;
