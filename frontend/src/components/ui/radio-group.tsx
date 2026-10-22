"use client"

import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
      ref={ref}
    />
  )
})
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

/**
 * `card`: the whole option is the radio — a bordered card holding the caller's
 * content, tinted teal once checked (the `ToggleGroup` card's on state). No
 * dot; the content names the radio. An inline `style` (a role's own hue)
 * overrides the checked colours.
 */
const radioCardClass =
  "rounded-lg border border-[color:var(--aqt-border)] px-3 py-1.5 text-left text-sm transition-[background-color,border-color,scale] duration-150 ease-out active:enabled:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=unchecked]:hover:bg-[color:var(--aqt-overlay-2)] data-[state=checked]:border-[color:var(--aqt-teal)] data-[state=checked]:bg-[color:color-mix(in_srgb,var(--aqt-teal)_10%,transparent)]"

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & { variant?: "default" | "card" }
>(({ className, variant = "default", children, ...props }, ref) => {
  if (variant === "card") {
    return (
      <RadioGroupPrimitive.Item
        ref={ref}
        data-slot="radio-group-item"
        className={cn(radioCardClass, className)}
        {...props}
      >
        {children}
      </RadioGroupPrimitive.Item>
    )
  }
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      data-slot="radio-group-item"
      className={cn(
        "aspect-square h-4 w-4 rounded-full border border-primary text-primary shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <Circle className="size-2 fill-current" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { RadioGroup, RadioGroupItem }
