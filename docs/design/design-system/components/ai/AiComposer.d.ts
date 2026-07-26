import * as React from 'react';

export interface AiComposerProps {
  value?: string;
  onChange?: (value: string) => void;
  onSend?: () => void;
  /** Called instead of onSend while a task is running; the button becomes a stop square. */
  onStop?: () => void;
  busy?: boolean;
  /** Number of selected canvas objects feeding the turn. */
  contextCount?: number;
  /** Up to a few object titles; the rest collapse into hiddenContextCount. */
  contextTitles?: React.ReactNode[];
  hiddenContextCount?: number;
  /** Summary shown on the disclosure trigger, e.g. 自动执行. */
  modeSummary?: React.ReactNode;
  turnMode?: 'auto' | 'confirm';
  onTurnModeChange?: (mode: string) => void;
  modeOpen?: boolean;
  onModeToggle?: () => void;
  /** <ImageSettings /> — only in an image task. */
  imageSettings?: React.ReactNode;
  placeholder?: string;
  style?: React.CSSProperties;
}

export interface ImageSettingsProps {
  /** 比例 · 规格 · 每方向预览数 — plain selects, human wording only. */
  fields?: Array<{ label: React.ReactNode; value?: string; options: string[]; disabled?: boolean; onChange?: (value: string) => void }>;
  notes?: React.ReactNode[];
  warning?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function AiComposer(props: AiComposerProps): JSX.Element;
export declare function ImageSettings(props: ImageSettingsProps): JSX.Element;
