import * as React from 'react';

export interface ProposalDraftObjectProps {
  role?: React.ReactNode;
  /** Reads 待确认 until the user accepts it. */
  state?: React.ReactNode;
  title?: React.ReactNode;
  summary?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function ProposalDraftObject(props: ProposalDraftObjectProps): JSX.Element;
