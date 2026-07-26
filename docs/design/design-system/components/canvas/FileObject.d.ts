import * as React from 'react';

export interface FileObjectProps {
  role?: React.ReactNode;
  /** File name as the user sees it, e.g. 课程要求.pdf */
  title?: React.ReactNode;
  /** Honest extraction state, e.g. "已提取文字". Never claim full parsing. */
  summary?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function FileObject(props: FileObjectProps): JSX.Element;
