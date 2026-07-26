import * as React from 'react';

export interface ResearchObjectProps {
  role?: React.ReactNode;
  /** Clamped to two lines on the canvas. */
  title?: React.ReactNode;
  /** Clamped to three lines. Findings, opportunities, constraints and open
   *  questions live in the detail popover, not on the card face. */
  summary?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function ResearchObject(props: ResearchObjectProps): JSX.Element;
