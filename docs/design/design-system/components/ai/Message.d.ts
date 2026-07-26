import * as React from 'react';

export interface MessageProps {
  role?: 'assistant' | 'user';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface CitationListProps {
  /** Each source keeps a way back: title plus domain or 本地资料 identifier. */
  items?: Array<{ title: React.ReactNode; origin?: React.ReactNode }>;
  onOpen?: (item: { title: React.ReactNode; origin?: React.ReactNode }, index: number) => void;
  style?: React.CSSProperties;
}

export declare function Message(props: MessageProps): JSX.Element;
export declare function MessageParagraph(props: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element;
export declare function ThinkingRow(props: { label?: string; style?: React.CSSProperties }): JSX.Element;
export declare function CitationList(props: CitationListProps): JSX.Element;
