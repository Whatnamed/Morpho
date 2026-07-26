import * as React from 'react';

export interface LeftRailProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface RailButtonProps {
  icon?: React.ReactNode;
  /** aria-label, title and tooltip text. */
  label?: string;
  /** Opens the matching drawer. Active buttons hide their tooltip. */
  active?: boolean;
  /** The circular 添加到画布 entry at the top. */
  create?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export declare function LeftRail(props: LeftRailProps): JSX.Element;
export declare function RailButton(props: RailButtonProps): JSX.Element;
export declare function RailSeparator(props: { style?: React.CSSProperties }): JSX.Element;
