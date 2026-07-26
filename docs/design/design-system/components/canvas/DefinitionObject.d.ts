import * as React from 'react';

export interface DefinitionObjectProps {
  role?: React.ReactNode;
  /** The core problem, one sentence. */
  title?: React.ReactNode;
  summary?: React.ReactNode;
  /** Only real states: 非当前定义 · 有修订草稿. Never a progress label. */
  statuses?: React.ReactNode[];
  style?: React.CSSProperties;
}

export declare function DefinitionObject(props: DefinitionObjectProps): JSX.Element;
