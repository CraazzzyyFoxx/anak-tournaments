import * as React from "react"

import { cn } from "@/lib/utils"

interface InputProps extends Omit<React.ComponentProps<"input">, "size"> {
  /** `sm` is the 32px toolbar row (13px text), `default` the 36px form row (14px). */
  size?: "sm" | "default"
}

// Below `sm` every field stays at 16px: iOS Safari zooms the page on focus
// into anything smaller.
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = "default", ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive",
          size === "sm" ? "h-8 sm:text-caption" : "h-9 sm:text-sm",
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
