"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

interface ToggleGroupProps extends VariantProps<typeof toggleVariants> {
  type: "single"
  value?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
  className?: string
}

interface ToggleGroupItemProps extends VariantProps<typeof toggleVariants> {
  value: string
  children: React.ReactNode
  className?: string
  disabled?: boolean
}

const ToggleGroupContext = React.createContext<{
  value?: string
  onValueChange?: (value: string) => void
  variant?: VariantProps<typeof toggleVariants>["variant"]
  size?: VariantProps<typeof toggleVariants>["size"]
}>({})

function ToggleGroup({
  className,
  variant,
  size,
  value,
  onValueChange,
  children,
}: ToggleGroupProps) {
  return (
    <ToggleGroupContext.Provider value={{ value, onValueChange, variant, size }}>
      <div
        role="group"
        className={cn(
          "flex items-center",
          "[&>*:not(:first-child)]:-ml-px",
          "[&>*:first-child]:rounded-r-none",
          "[&>*:last-child]:rounded-l-none",
          "[&>*:not(:first-child):not(:last-child)]:rounded-none",
          "[&>*[data-state=on]]:z-10 [&>*[data-state=on]]:relative",
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
}: ToggleGroupItemProps) {
  const context = React.useContext(ToggleGroupContext)
  const isOn = context.value === value

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isOn}
      data-state={isOn ? "on" : "off"}
      disabled={disabled}
      onClick={() => context.onValueChange?.(value)}
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
