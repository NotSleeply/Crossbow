import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "secondary" | "primary" | "accent";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

/** 统一按钮：variant 决定填充/描边样式，hover/active/disabled
 *  由 .cb-btn 体系承载；data-variant 供 CSS 提高填充态优先级。 */
export function Button({
  variant = "secondary",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "cb-btn",
    variant === "secondary" ? "" : variant,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} data-variant={variant} className={classes} {...rest}>
      {children}
    </button>
  );
}
