"use client"

import { cva } from "class-variance-authority"

/**
 * `pill` is the site's segmented-control look: a bordered card holding flat
 * items, the active one tinted teal. It is the same drawing as the tournament
 * page's `.stage-tabs`, expressed in Tailwind so `ToggleGroup` and the bracket's
 * stage/view tabs cannot drift apart. `default`/`outline` are the shadcn joined
 * buttons, kept for the admin surfaces that already use them.
 */
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors",
  {
    variants: {
      variant: {
        default: "bg-transparent hover:bg-muted hover:text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        outline: "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        pill: "rounded-[7px] font-semibold text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-fg)] data-[state=on]:bg-[color:color-mix(in_srgb,var(--aqt-teal)_14%,transparent)] data-[state=on]:text-[color:var(--aqt-teal)] data-[state=on]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--aqt-teal)_30%,transparent)]",
      },
      size: {
        default: "h-9 px-4 min-w-9 rounded-md",
        sm: "h-8 px-3 min-w-8 rounded-md",
        lg: "h-10 px-5 min-w-10 rounded-md",
      },
    },
    compoundVariants: [
      // The pill sits inside a 3px-padded frame, so its own height is the row
      // height minus that frame: an `sm` pill group is 32px tall like the
      // `sm` select and search field beside it.
      { variant: "pill", size: "sm", class: "h-6 min-w-6 rounded-[7px] px-3 text-[12.5px]" },
      { variant: "pill", size: "default", class: "h-7 min-w-7 rounded-[7px] px-3.5 text-[13px]" },
      { variant: "pill", size: "lg", class: "h-8 min-w-8 rounded-[7px] px-4 text-sm" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export { toggleVariants }
