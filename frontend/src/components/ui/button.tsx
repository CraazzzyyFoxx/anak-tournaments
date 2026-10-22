"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        /** A "go" confirmation the player can miss (check in): emerald fill. */
        positive: "bg-[color:var(--aqt-emerald)] text-[color:var(--aqt-bg)] shadow hover:brightness-110",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        /** An icon-only remove/delete beside a row: quiet at rest, the destructive tint on hover. */
        "ghost-destructive": "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
        link: "text-primary underline-offset-4 hover:underline",
        /** Quiet bordered fill on the `--aqt-*` surface: a card's retry, a pager, a toolbar trigger. */
        subtle:
          "border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] text-[color:var(--aqt-fg)] hover:bg-[color:var(--aqt-overlay-3)]",
        /** "Add one more" affordance: dashed outline, teal on hover (a phase, a match, a round). */
        dashed:
          "border border-dashed border-[color:var(--aqt-border-2)] text-[color:var(--aqt-fg-muted)] hover:border-[color:var(--aqt-teal)] hover:text-[color:var(--aqt-teal)]",
        /** The row's primary action on the `--aqt-*` surface (open a scoreboard, report a result): teal tint. */
        accent:
          "border border-[color:color-mix(in_srgb,var(--aqt-teal)_32%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-teal)_12%,transparent)] text-[color:var(--aqt-teal)] hover:bg-[color:color-mix(in_srgb,var(--aqt-teal)_18%,transparent)]"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-caption",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
        /** A secondary icon beside text (an explainer, a row action): 28px box, 14px glyph. */
        "icon-sm": "h-7 w-7 [&_svg]:size-3.5",
        /** A dense strip's text action (a canvas header's "+ match", a field's reset): 24px, label text, 12px glyph. */
        xs: "h-6 gap-1 rounded-md px-2 text-label [&_svg]:size-3",
        /** An icon inside a dense strip (a bracket card's footer, a wiring port): 20px box, 14px glyph or a label-size letter. */
        "icon-xs": "h-5 w-5 rounded text-label [&_svg]:size-3.5",
        /** Text action inside a sentence or row (`variant="link"`): no box, the surrounding text size. */
        inline: "h-auto rounded-sm p-0 text-[length:inherit]",
        /** A sortable column head's own label (`variant="ghost"`): no box, the eyebrow voice, 12px glyph. Font family follows the cell. */
        label: "h-auto gap-1 rounded-sm p-0 text-label font-semibold uppercase tracking-label [&_svg]:size-3"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Opt out of press motion by default; interactive notification controls opt in. */
  static?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, static: isStatic = true, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size }),
          !isStatic &&
            "motion-safe:transition-[color,background-color,border-color,box-shadow,scale] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:enabled:scale-[0.96]",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
