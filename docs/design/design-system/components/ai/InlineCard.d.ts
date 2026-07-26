import * as React from 'react';

export interface InlineCardProps {
  /** confirm = a decision to accept · failure = something did not finish · note = a quiet context notice */
  tone?: 'confirm' | 'failure' | 'note';
  title?: React.ReactNode;
  /** What was preserved, e.g. 原图与修改要求已保留。 */
  meta?: React.ReactNode;
  children?: React.ReactNode;
  /** <Button /> elements: 保存 / 重试 / 修改后重试 / 取消并保留原图 … */
  actions?: React.ReactNode;
  onDismiss?: () => void;
  style?: React.CSSProperties;
}

export interface ProposalCardProps {
  title?: React.ReactNode;
  /** 待确认 until the user accepts it. */
  state?: React.ReactNode;
  meta?: React.ReactNode[];
  /** One plain sentence explaining what accepting will do. */
  help?: React.ReactNode;
  /** 主要发现 / 机会点 / 限制约束 / 待验证问题 */
  sections?: Array<{ label: React.ReactNode; items: React.ReactNode[] }>;
  citations?: React.ReactNode[];
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function InlineCard(props: InlineCardProps): JSX.Element;
export declare function ProposalCard(props: ProposalCardProps): JSX.Element;
