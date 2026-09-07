"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverClose = PopoverPrimitive.Close;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & { animate?: boolean }
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      animate = true,
      onWheelCapture,
      onTouchMove,
      ...props
    },
    ref
  ) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        // Keep wheel/touch inside the popover, or a scrollable body of one opened
        // from a modal Dialog cannot scroll at all.
        //
        // Radix Dialog wraps its content in react-remove-scroll, which registers a
        // NON-capture `wheel`/`touchmove` listener on `document`. That listener
        // preventDefaults any event it cannot attribute to the locked subtree or to
        // a declared shard — and this content is portalled to `document.body`, so
        // it is neither. The default scroll action runs only after dispatch
        // finishes, so the list never moves even though it overflows.
        //
        // Radix Select/DropdownMenu are unaffected: each is modal in its own right
        // and installs its own lock, which registers its content. Popover is not,
        // so it has to keep the event away from `document` itself.
        onWheelCapture={(event) => {
          onWheelCapture?.(event);
          event.stopPropagation();
        }}
        onTouchMove={(event) => {
          onTouchMove?.(event);
          event.stopPropagation();
        }}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none origin-[--radix-popover-content-transform-origin]",
          animate &&
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose };
