"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * `panel` is a work surface rather than a message: flush (no padding or gap),
 * popover fill, deep shadow, a flex column that clips, so the body runs its own
 * scroller under a header ruled off by `DialogHeader variant="panel"`.
 * `SheetContent` takes the same variant.
 */
type PanelVariant = "default" | "panel";

const PANEL_CONTENT_CLASS =
  "flex flex-col gap-0 overflow-hidden border-border bg-popover p-0 text-[color:var(--aqt-fg)] shadow-2xl shadow-black/50";
const PANEL_HEADER_CLASS = "shrink-0 border-b border-[color:var(--aqt-border)] px-5 py-4 text-left";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { variant?: PanelVariant }
>(({ className, children, variant = "default", ...props }, ref) => {
  const t = useTranslations();
  return (
  <DialogPortal>
    <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // Height cap + `overflow-auto` (not `overflow-y-auto`) so a dialog
          // taller than the viewport scrolls instead of running off both edges.
          // `overflow-auto` shares tailwind-merge's `overflow` group, so the
          // surfaces that manage their own scrolling (`overflow-hidden` + an
          // inner scroller) still override it; `overflow-y-*` would not.
          "fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto overscroll-contain rounded-2xl border border-border/70 bg-card/95 p-6 shadow-xl transition-all duration-200 ease-out data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 data-[state=closed]:scale-95 data-[state=open]:opacity-100 data-[state=open]:scale-100",
          variant === "panel" && PANEL_CONTENT_CLASS,
          className
        )}
        {...props}
      >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" aria-hidden />
        <span className="sr-only">{t("common.close")}</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: PanelVariant }) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      variant === "panel" && PANEL_HEADER_CLASS,
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  PANEL_CONTENT_CLASS,
  PANEL_HEADER_CLASS
};
export type { PanelVariant };
