import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { TONE_CLASS, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: TONE_CLASS.neutral,
        destructive: TONE_CLASS.danger,
        outline: "border-border/60 bg-transparent text-foreground",
        accent: TONE_CLASS.accent,
        success: TONE_CLASS.success,
        warning: TONE_CLASS.warning,
        info: TONE_CLASS.info
      },
      shape: {
        badge: "rounded-md",
        pill: "rounded-full"
      }
    },
    defaultVariants: {
      variant: "default",
      shape: "badge"
    }
  }
);

const TONE_VARIANT = {
  neutral: "secondary",
  accent: "accent",
  success: "success",
  warning: "warning",
  info: "info",
  danger: "destructive"
} as const satisfies Record<Tone, NonNullable<VariantProps<typeof badgeVariants>["variant"]>>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Semantic tone; wins over `variant` when both are set. */
  tone?: Tone;
}

function Badge({ className, variant, shape, tone, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        badgeVariants({
          variant: tone ? TONE_VARIANT[tone] : variant,
          shape
        }),
        className
      )}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
