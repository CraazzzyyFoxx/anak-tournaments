import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { TONE_CLASS, type Tone } from "@/components/admin/tone";
import { cn } from "@/lib/utils";

export interface StatusPillProps extends ComponentPropsWithoutRef<"span"> {
  tone: Tone;
  children: ReactNode;
  /**
   * Leading dot in the pill's own tone, for a live/running state. Decorative:
   * the label beside it carries the state, so the dot is `aria-hidden`.
   */
  dot?: boolean;
}

/**
 * The admin's one *state* marker: tournament status, version state, collector
 * run state, account active/disabled. Rounded-full + `TONE_CLASS`.
 *
 * `Badge` (rounded-md) stays for *categories* — a role name, a scope, a kind.
 * The distinction is the whole point: a pill means "where this thing is in its
 * lifecycle", a badge means "what kind of thing it is". Before this the same
 * class string was retyped in nine places and one screen reached past the tone
 * vocabulary into `emerald-500`.
 */
export function StatusPill({
  tone,
  children,
  dot = false,
  className,
  ...props
}: Readonly<StatusPillProps>) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className
      )}
      {...props}
    >
      {dot ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
