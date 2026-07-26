import * as React from 'react';

export interface SideDrawerProps {
  open?: boolean;
  /** 项目地图 · 资产 · 已隐藏内容 · 项目记录 */
  title?: React.ReactNode;
  /** Trailing control in the drawer head, usually a close button. */
  meta?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface MapItemProps {
  children?: React.ReactNode;
  /** Trailing affordance — an arrow or a count, never a percentage. */
  meta?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export interface AssetRowProps {
  /** Two-character kind mark, e.g. 图 / 文 / 链. */
  mark?: React.ReactNode;
  title?: React.ReactNode;
  /** <Chip kind="status"> for a state like 已隐藏. */
  status?: React.ReactNode;
  meta?: React.ReactNode[];
  note?: React.ReactNode;
  action?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export declare function SideDrawer(props: SideDrawerProps): JSX.Element;
export declare function DrawerNote(props: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element;
export declare function DrawerGroupTitle(props: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element;
export declare function MapItem(props: MapItemProps): JSX.Element;
export declare function AssetRow(props: AssetRowProps): JSX.Element;
