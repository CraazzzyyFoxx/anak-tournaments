"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  /**
   * A CSS colour (a role's tint): a slim track filled, and a thumb drawn, in
   * it -- the rank slider of a role card. Without one, the primary look.
   */
  accent?: string;
};

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, style, accent, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...props }, ref) => (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        accent && "cursor-pointer data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      style={accent ? ({ "--slider-accent": accent, ...style } as React.CSSProperties) : style}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          "relative w-full grow overflow-hidden rounded-full",
          accent ? "h-1 bg-[color:var(--aqt-overlay-3)]" : "h-1.5 bg-muted",
        )}
      >
        <SliderPrimitive.Range
          className={cn("absolute h-full", accent ? "bg-[color:var(--slider-accent)]" : "bg-primary")}
        />
      </SliderPrimitive.Track>
      {/* The thumb is the `role="slider"` element, so the accessible name has to
          land there -- on the root it would sit on a span with no role and be
          dropped. A `<Label>` next to the control cannot associate with it
          either: neither the root nor the thumb is a labelable element. */}
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          "block rounded-full shadow-sm transition-colors hover:ring-4 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
          accent ? "size-3.5 bg-[color:var(--slider-accent)]" : "h-4 w-4 border border-primary bg-white",
        )}
      />
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
