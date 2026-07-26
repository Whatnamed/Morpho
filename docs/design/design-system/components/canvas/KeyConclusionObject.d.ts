import * as React from 'react';

export interface KeyConclusionObjectProps {
  /** Vertical marker: 结论, or the extraction kind — 发现 / 机会点 / 约束 / 待验证. */
  marker?: React.ReactNode;
  role?: React.ReactNode;
  /** One conclusion, clamped to three lines. */
  title?: React.ReactNode;
  /** Optional supporting line, clamped to two. */
  detail?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function KeyConclusionObject(props: KeyConclusionObjectProps): JSX.Element;
