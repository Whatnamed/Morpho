import * as React from 'react';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  /** plain = .plain-button · brand = .brand-button · icon = .icon-button (30×28, square) */
  variant?: 'plain' | 'brand' | 'icon';
  /** Leading <Icon />: 14px in plain/brand, 16px in icon buttons. */
  icon?: React.ReactNode;
  children?: React.ReactNode;
  disabled?: boolean;
  /** Required for icon buttons — becomes both title and aria-label. */
  title?: string;
  style?: React.CSSProperties;
}

export declare function Button(props: ButtonProps): JSX.Element;
