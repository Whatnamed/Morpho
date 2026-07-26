import * as React from 'react';

export interface TooltipProps {
  children?: React.ReactNode;
  visible?: boolean;
  style?: React.CSSProperties;
}

export declare function Tooltip(props: TooltipProps): JSX.Element;
