"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type CanvasIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  active?: boolean;
  pressed?: boolean;
  danger?: boolean;
  children: ReactNode;
};

/** Icon-only action with an accessible name and a lightweight canvas tooltip. */
export function CanvasIconButton({
  label,
  active = false,
  pressed,
  danger = false,
  className,
  children,
  ...props
}: CanvasIconButtonProps) {
  return (
    <button
      {...props}
      className={[
        "canvas-icon-button",
        active ? "is-active" : "",
        danger ? "is-danger" : "",
        className ?? ""
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={label}
      title={label}
    >
      {children}
    </button>
  );
}
