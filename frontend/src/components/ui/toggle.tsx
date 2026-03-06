"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors",
  {
    variants: {
      variant: {
        default: "bg-transparent hover:bg-muted hover:text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        outline: "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 min-w-9 rounded-md",
        sm: "h-8 px-3 min-w-8 rounded-md",
        lg: "h-10 px-5 min-w-10 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export { toggleVariants }
