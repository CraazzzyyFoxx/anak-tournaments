import type { ReactNode } from "react";

import { EYEBROW_CLASS } from "@/components/kit/tone";
import { cn } from "@/lib/utils";

/**
 * One labelled fact inside an `Inspector` body or a detail dialog: eyebrow
 * label, value below. Nine panels drew their own copy of this before.
 *
 * A missing value renders nothing: an empty inspector row says less than no
 * row, and a dash placeholder is a fact that does not exist.
 */
export function InspectorField({
  label,
  children,
  className
}: Readonly<{ label: string; children: ReactNode; className?: string }>) {
  if (children === null || children === undefined || children === "" || children === false) return null;
  return (
    <div className={cn("min-w-0", className)}>
      <p className={EYEBROW_CLASS}>{label}</p>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

/**
 * A titled group inside an inspector: eyebrow heading over its content, set
 * off from the previous group by a hairline, never by its own border. A box
 * inside the inspector's box is the card-in-a-card §5 forbids.
 */
export function InspectorSection({
  title,
  children,
  className
}: Readonly<{ title: string; children: ReactNode; className?: string }>) {
  return (
    <section className={cn("border-t border-border/60 pt-3 first:border-t-0 first:pt-0", className)}>
      <h3 className={EYEBROW_CLASS}>{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}
