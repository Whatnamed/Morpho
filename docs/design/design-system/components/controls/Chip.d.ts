import * as React from 'react';

export interface ChipProps {
  /** filter = drawer filters · suggestion = AI suggestions · status = read-only row mark */
  kind?: 'filter' | 'suggestion' | 'status';
  active?: boolean;
  /** Full pill radius — how suggestion chips render inside the AI panel. */
  pill?: boolean;
  children?: React.ReactNode;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}

export declare function Chip(props: ChipProps): JSX.Element;
