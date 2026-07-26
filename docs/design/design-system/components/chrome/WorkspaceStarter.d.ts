import * as React from 'react';

export interface WorkspaceStarterProps {
  kicker?: React.ReactNode;
  title?: React.ReactNode;
  body?: React.ReactNode;
  /** Two or three <Button /> entries at 36px height. */
  actions?: React.ReactNode;
  hint?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface SaveToastProps {
  visible?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function WorkspaceStarter(props: WorkspaceStarterProps): JSX.Element;
export declare function SaveToast(props: SaveToastProps): JSX.Element;
