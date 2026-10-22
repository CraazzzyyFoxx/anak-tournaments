"use client"

import { cva } from "class-variance-authority"

/**
 * `pill` is the site's segmented-control look: a bordered card holding flat
 * items, the active one tinted teal. Every segmented control on the site draws
 * it — `ToggleGroup`, the bracket's stage links, and the Radix `Tabs` rows — so
 * the variant answers to BOTH state attributes: `data-state=on` (ToggleGroup,
 * links) and `data-state=active` (Radix Tabs). `default`/`outline` are the
 * shadcn joined buttons, kept for the admin surfaces that already use them.
 * `card` is a choice between whole options (a caption over a value or a
 * picture): each item is its own bordered card, laid out by the group's grid.
 */
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors",
  {
    variants: {
      variant: {
        default: "bg-transparent hover:bg-muted hover:text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        outline: "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        // The on state reads `--toggle-accent` when an item sets one (teal otherwise); Tabs' `active` stays teal.
        pill: "rounded-[7px] text-[color:var(--aqt-fg-muted)] hover:text-[color:var(--aqt-fg)] data-[state=on]:bg-[color:color-mix(in_srgb,var(--toggle-accent,var(--aqt-teal))_14%,transparent)] data-[state=on]:text-[color:var(--toggle-accent,var(--aqt-teal))] data-[state=on]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--toggle-accent,var(--aqt-teal))_30%,transparent)] data-[state=active]:bg-[color:color-mix(in_srgb,var(--aqt-teal)_14%,transparent)] data-[state=active]:text-[color:var(--aqt-teal)] data-[state=active]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--aqt-teal)_30%,transparent)]",
        // The accent is `--toggle-accent` when an item sets one (teal otherwise).
        card: "flex-col items-stretch justify-start gap-0.5 rounded-md border border-[color:var(--aqt-border)] text-left font-normal text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-2)] data-[state=on]:border-[color:var(--toggle-accent,var(--aqt-teal))] data-[state=on]:bg-[color:color-mix(in_srgb,var(--toggle-accent,var(--aqt-teal))_10%,transparent)] data-[state=on]:text-[color:var(--aqt-fg)]",
      },
      size: {
        default: "h-9 px-4 min-w-9 rounded-md",
        sm: "h-8 px-3 min-w-8 rounded-md text-caption",
        lg: "h-10 px-5 min-w-10 rounded-md",
      },
    },
    compoundVariants: [
      // The pill sits inside a 3px-padded frame, so its own height is the row
      // height minus that frame: an `sm` pill group is 32px tall like the
      // `sm` select and search field beside it. Text follows the ROW height
      // (32px → 13px, 36/40px → 14px), the same scale as every other control.
      { variant: "pill", size: "sm", class: "h-6 min-w-6 rounded-[7px] px-3 text-caption" },
      { variant: "pill", size: "default", class: "h-7 min-w-7 rounded-[7px] px-3.5 text-sm" },
      { variant: "pill", size: "lg", class: "h-8 min-w-8 rounded-[7px] px-4 text-sm" },
      // A card holds a caption over a value, so its height is its content's.
      { variant: "card", size: ["sm", "default", "lg"], class: "h-auto min-w-0 px-3 py-2" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * The frame every segmented control draws around its items: a 3px-padded
 * bordered card. With `size="sm"` items (24px) that lands on a 32px row, level
 * with the search field and sort select beside it.
 */
const segmentedFrame =
  "inline-flex items-center gap-1 rounded-[10px] border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-[3px]"

export { segmentedFrame, toggleVariants }
