import * as React from 'react';

export interface AgentProcessProps {
  /** What is happening now, in the user's language — never a model thought. */
  title?: React.ReactNode;
  open?: boolean;
  /** Adds the title shimmer while the turn streams. */
  streaming?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface AgentActivityProps {
  kind?: 'webSearch' | 'fileRead' | 'contextRead' | 'imageGeneration' | 'tool';
  label?: React.ReactNode;
  detail?: React.ReactNode;
  state?: 'running' | 'done' | 'failed';
  style?: React.CSSProperties;
}

export declare function AgentProcess(props: AgentProcessProps): JSX.Element;
export declare function AgentActivity(props: AgentActivityProps): JSX.Element;
export declare function AgentNote(props: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element;
