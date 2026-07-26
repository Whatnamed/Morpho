import * as React from 'react';

/**
 * @startingPoint section="Workspace chrome" subtitle="Floating clusters, rail, drawer, detail popover" viewport="700x420"
 */
export interface FloatingClusterProps {
  side?: 'left' | 'right';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface ToolbarGroupProps {
  /** Accessible group name, e.g. 视图 / 资料与交付. */
  label?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface WordmarkProps {
  size?: number;
  style?: React.CSSProperties;
}

export interface ProjectNameProps {
  name?: React.ReactNode;
  /** Quiet context suffix. Never a task count or stage percentage. */
  subtitle?: React.ReactNode;
  /** Only a real persistence problem, e.g. 本地保存失败. */
  warning?: React.ReactNode;
  /** <Icon name="chevron-down" size={13} /> when a project menu is attached. */
  caret?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export declare function FloatingCluster(props: FloatingClusterProps): JSX.Element;
export declare function ToolbarGroup(props: ToolbarGroupProps): JSX.Element;
export declare function Wordmark(props: WordmarkProps): JSX.Element;
export declare function ProjectName(props: ProjectNameProps): JSX.Element;
export declare function ClusterDivider(props: { style?: React.CSSProperties }): JSX.Element;
