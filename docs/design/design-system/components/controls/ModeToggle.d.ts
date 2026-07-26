import * as React from 'react';

export interface ModeToggleProps {
  value?: string;
  /** In the composer: 自动执行 / 先确认. */
  options?: Array<{ value: string; label: React.ReactNode }>;
  onChange?: (value: string) => void;
  label?: string;
  style?: React.CSSProperties;
}

export declare function ModeToggle(props: ModeToggleProps): JSX.Element;
