import * as React from 'react';

export interface DetailPopoverProps {
  visible?: boolean;
  /** Object type label: 图片 · 文件 · 研究与分析 · 关键结论 · 设计定义 · 概念方向 … */
  type?: React.ReactNode;
  /** Object title, or 已选 N 项 for a multi-selection. */
  title?: React.ReactNode;
  /** Only the tabs that have content: 信息 / 来源 / 版本 / 关联 / 决策. */
  tabs?: string[];
  activeTab?: string;
  onTab?: (tab: string) => void;
  /** <DetailInlineAction /> elements. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface DetailRowProps {
  /** 父版本 · 子版本 · 来源文件 · 已确认 … */
  label?: React.ReactNode;
  children?: React.ReactNode;
  meta?: React.ReactNode;
  /** 32px object thumbnail when the row points at another canvas object. */
  thumbnail?: React.ReactNode;
  /** Makes the row a button that locates the referenced object. */
  onClick?: () => void;
  style?: React.CSSProperties;
}

export interface DetailInlineActionProps {
  icon?: React.ReactNode;
  children?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export declare function DetailPopover(props: DetailPopoverProps): JSX.Element;
export declare function DetailRow(props: DetailRowProps): JSX.Element;
export declare function DetailInlineAction(props: DetailInlineActionProps): JSX.Element;
export declare function DetailMeta(props: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element;
