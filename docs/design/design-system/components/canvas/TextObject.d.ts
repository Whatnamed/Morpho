import * as React from 'react';

export interface TextObjectProps {
  role?: React.ReactNode;
  title?: React.ReactNode;
  lines?: React.ReactNode[];
  style?: React.CSSProperties;
}

export declare function TextObject(props: TextObjectProps): JSX.Element;
