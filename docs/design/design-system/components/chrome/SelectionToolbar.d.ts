import * as React from 'react';

export interface SelectionToolbarProps {
  children?: React.ReactNode;
  /** Stage-region variant (colour / border / opacity / lock controls). */
  stage?: boolean;
  style?: React.CSSProperties;
}

export interface CanvasIconButtonProps {
  icon?: React.ReactNode;
  /** aria-label and tooltip text. Required. */
  label?: string;
  /** Optional text label; omitting it makes the control icon-only. */
  children?: React.ReactNode;
  /** Destructive or rare actions sit one step quieter. */
  secondary?: boolean;
  active?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export interface StageColorSwatchProps {
  color?: string;
  selected?: boolean;
  onClick?: () => void;
  label?: string;
  style?: React.CSSProperties;
}

export declare function SelectionToolbar(props: SelectionToolbarProps): JSX.Element;
export declare function ToolbarGroupInline(props: { secondary?: boolean; children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element;
export declare function ToolbarDivider(props: { style?: React.CSSProperties }): JSX.Element;
export declare function CanvasIconButton(props: CanvasIconButtonProps): JSX.Element;
export declare function StageColorSwatch(props: StageColorSwatchProps): JSX.Element;
export declare function ToolbarPopover(props: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element;
