import * as React from 'react';

export interface RoleLabelProps {
  /** 图片 · 文件 · 研究与分析 · 关键结论 · 设计定义 · 概念方向 · 交付准备 … */
  children?: React.ReactNode;
  /** Selects the leading mark shape for this object family. */
  family?: 'file' | 'documentFragment' | 'research' | 'keyConclusion' | 'designDefinition' | 'conceptDirection' | 'proposalDraft' | 'text' | 'delivery' | 'default';
  color?: string;
  style?: React.CSSProperties;
}

export declare function RoleLabel(props: RoleLabelProps): JSX.Element;
