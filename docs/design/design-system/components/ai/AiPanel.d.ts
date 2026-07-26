import * as React from 'react';

/**
 * @startingPoint section="AI surface" subtitle="Conversation panel, agent process, composer" viewport="700x520"
 */
export interface AiPanelProps {
  open?: boolean;
  onToggle?: () => void;
  /** <AiComposer /> — sits on the same continuous surface, no footer slab. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface AiToggleProps {
  open?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export interface AiQueueProps {
  /** Short status word: 空闲 / 生成中 / 研究中 … */
  label?: React.ReactNode;
  /** Adds the umber pulse dot. */
  busy?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** Popover body: what is running, plus a 停止 action. */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function AiPanel(props: AiPanelProps): JSX.Element;
export declare function AiToggle(props: AiToggleProps): JSX.Element;
export declare function AiQueue(props: AiQueueProps): JSX.Element;
