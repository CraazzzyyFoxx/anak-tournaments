"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { segmentedFrame, toggleVariants } from "@/components/ui/toggle"

interface ToggleGroupProps extends VariantProps<typeof toggleVariants> {
  type: "single"
  value?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
  className?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
  "aria-required"?: boolean
  "aria-invalid"?: boolean
}

interface ToggleGroupItemProps extends VariantProps<typeof toggleVariants> {
  value: string
  children: React.ReactNode
  className?: string
  disabled?: boolean
  /** Colour of the on state instead of teal (`pill`, `card`): a CSS colour or token, e.g. a role's hue. */
  accent?: string
  "aria-label"?: string
  "aria-describedby"?: string
  /** Language of the item's own label (a language switcher's endonyms). */
  lang?: string
}

const ToggleGroupContext = React.createContext<{
  value?: string
  onValueChange?: (value: string) => void
  variant?: VariantProps<typeof toggleVariants>["variant"]
  size?: VariantProps<typeof toggleVariants>["size"]
  /** Roving focus is only safe once one item owns the group's tab stop. */
  roving?: boolean
  /**
   * With nothing selected, the first enabled option holds the tab stop (APG
   * radio group). `null` when the options are not direct children, so their
   * values cannot be read: then every option stays tabbable.
   */
  firstValue?: string | null
}>({})

/** Arrow keys that move within a radiogroup, and the direction each one moves. */
const ARROW_STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1
}

/** The first enabled direct child's `value`, or `null` when none is readable. */
function firstOptionValue(children: React.ReactNode): string | null {
  for (const child of React.Children.toArray(children)) {
    if (!React.isValidElement<{ value?: unknown; disabled?: boolean }>(child)) continue
    if (typeof child.props.value === "string" && !child.props.disabled) return child.props.value
  }
  return null
}

/**
 * Single-select segmented control.
 *
 * The items are radios, so the container must be a `radiogroup` and the group
 * must behave like one: exactly one tab stop, arrow keys moving *and* selecting
 * (ARIA APG radio-group pattern). Before this, every segment was its own tab
 * stop inside a plain `role="group"`, and an `aria-label` passed by a caller was
 * dropped — TypeScript accepts any hyphenated JSX attribute, so nothing flagged it.
 */
function ToggleGroup({
  className,
  variant,
  size,
  value,
  onValueChange,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-required": ariaRequired,
  "aria-invalid": ariaInvalid
}: Readonly<ToggleGroupProps>) {
  const roving = value != null && value !== ""
  const firstValue = roving ? null : firstOptionValue(children)

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = ARROW_STEP[event.key]
    if (step === undefined) return

    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    ].filter((item) => !item.disabled)
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    if (current === -1) return

    event.preventDefault()
    const next = items[(current + step + items.length) % items.length]
    next.focus()
    next.click()
  }

  return (
    <ToggleGroupContext.Provider value={{ value, onValueChange, variant, size, roving, firstValue }}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={ariaRequired}
        aria-invalid={ariaInvalid}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex items-center",
          variant === "pill"
            ? segmentedFrame
            : variant === "card"
              ? // Separate cards: the caller's `grid-cols-*` lays them out.
                "grid items-stretch gap-2"
              : cn(
                  "[&>*:not(:first-child)]:-ml-px",
                  "[&>*:first-child]:rounded-r-none",
                  "[&>*:last-child]:rounded-l-none",
                  "[&>*:not(:first-child):not(:last-child)]:rounded-none",
                  "[&>*[data-state=on]]:z-10 [&>*[data-state=on]]:relative"
                ),
          className
        )}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  )
}

function ToggleGroupItem({
  className,
  children,
  value,
  variant,
  size,
  disabled,
  accent,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  lang,
}: Readonly<ToggleGroupItemProps>) {
  const context = React.useContext(ToggleGroupContext)
  const isOn = context.value === value

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isOn}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      lang={lang}
      data-state={isOn ? "on" : "off"}
      tabIndex={
        context.roving
          ? isOn ? 0 : -1
          : context.firstValue == null || context.firstValue === value ? 0 : -1
      }
      disabled={disabled}
      onClick={() => context.onValueChange?.(value)}
      style={accent ? ({ "--toggle-accent": accent } as React.CSSProperties) : undefined}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
    >
      {children}
    </button>
  )
}

export { ToggleGroup, ToggleGroupItem }
