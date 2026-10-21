"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A whole list row that is one action — select a team, open a player. The
 * caller lays the cells out; the primitive owns the reset, the row hover
 * (`--aqt-overlay-2`), the selected state (`aria-current`, `--aqt-overlay-3`)
 * and the inset focus ring (DESIGN.md §5, §12).
 */
const RowButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "w-full cursor-pointer text-left outline-none transition-colors",
        "hover:bg-[color:var(--aqt-overlay-2)] aria-[current=true]:bg-[color:var(--aqt-overlay-3)]",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--aqt-teal)]",
        "disabled:cursor-default disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
RowButton.displayName = "RowButton";

export { RowButton };
