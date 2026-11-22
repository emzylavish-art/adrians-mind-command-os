import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "icon";

export function ChatButton({
  variant = "secondary",
  selected = false,
  loading = false,
  reason,
  className = "",
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  selected?: boolean;
  loading?: boolean;
  reason?: string;
}) {
  return (
    <button
      {...rest}
      className={`chat-button chat-button--${variant}${selected ? " is-selected" : ""}${loading ? " is-loading" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      aria-disabled={disabled || loading || undefined}
      aria-pressed={selected ? true : rest["aria-pressed"]}
      title={disabled && reason ? reason : rest.title}
    >
      {children}
    </button>
  );
}
