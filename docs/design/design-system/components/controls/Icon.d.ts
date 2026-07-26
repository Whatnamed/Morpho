import * as React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** Lucide glyph name in kebab-case, e.g. "eye-off". */
  name: string;
  /** 16 in the rail and top cluster, 14 in plain buttons, 13 in agent activity rows. */
  size?: number;
  /** Lucide default is 2. The product does not override it. */
  strokeWidth?: number;
}

export declare function Icon(props: IconProps): JSX.Element;
export declare const MORPHO_ICONS: Record<string, string[]>;
