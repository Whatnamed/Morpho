import * as React from 'react';

/**
 * @startingPoint section="Canvas objects" subtitle="Every canvas material family in one board" viewport="700x480"
 */
export interface MorphoObjectProps {
  left: number;
  top: number;
  width?: number;
  /** Blue-gray outline + halo. Never lifts the object. */
  selected?: boolean;
  /** Part of the active design trace: umber ring. */
  designTrace?: boolean;
  /** Referenced from the open detail popover: same ring as selection. */
  referenceHighlight?: boolean;
  /** Eliminated directions render at 0.68 opacity and stay on the canvas. */
  quiet?: boolean;
  /** Images only: pins the 后续默认参考 mark to the top-left corner. */
  defaultReference?: boolean;
  radius?: string | number;
  onSelect?: (e: React.MouseEvent) => void;
  ariaLabel?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare function MorphoObject(props: MorphoObjectProps): JSX.Element;
