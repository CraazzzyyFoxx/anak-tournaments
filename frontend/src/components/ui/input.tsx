import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The public site's control surface (DESIGN §5 "Controls"): 8px radius,
 * `--aqt-overlay-2` fill, `--aqt-border-2` hairline and a real focus ring; red
 * once the control is `aria-invalid`. Exported for a trigger that has no
 * `variant` of its own — set `aria-invalid` on it for the error state.
 */
export const controlSurfaceClass =
  "w-full rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] px-3 " +
  "text-[color:var(--aqt-fg)] shadow-none placeholder:text-[color:var(--aqt-fg-dim)] transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background aria-invalid:border-destructive aria-invalid:text-destructive " +
  "aria-invalid:placeholder:text-destructive/60"

interface InputProps extends Omit<React.ComponentProps<"input">, "size"> {
  /** `sm` is the 32px toolbar row (13px text), `default` the 36px form row (14px). */
  size?: "sm" | "default"
  /** `surface` is the public-site control skin ({@link controlSurfaceClass}). */
  variant?: "default" | "surface"
}

// Below `sm` every field stays at 16px: iOS Safari zooms the page on focus
// into anything smaller.
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = "default", variant = "default", ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive",
          size === "sm" ? "h-8 sm:text-caption" : "h-9 sm:text-sm",
          variant === "surface" && controlSurfaceClass,
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
