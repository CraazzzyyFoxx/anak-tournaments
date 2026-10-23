import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * The eyebrow: the small uppercase label above a value, a column or a section
 * (design book `.eyebrow`) — label voice, `text-label`, semibold, `tracking-label`.
 *
 * `tone` picks the text step and nothing else: `faint` is the DESIGN §2 label
 * floor, `dim` the meta step, `muted` the admin surfaces' label.
 */
export type EyebrowTone = "faint" | "dim" | "muted";

const EYEBROW_TONE: Record<EyebrowTone, string> = {
  faint: "text-[color:var(--aqt-fg-faint)]",
  dim: "text-[color:var(--aqt-fg-dim)]",
  muted: "text-[color:var(--aqt-fg-muted)]"
};

/** The eyebrow recipe as a class string, for elements `Eyebrow` cannot be (a `<th>`, a `Link`, a composed `cn`). */
export function eyebrowClass(tone: EyebrowTone = "faint") {
  return `font-[family-name:var(--aqt-data)] text-label font-semibold uppercase tracking-label ${EYEBROW_TONE[tone]}`;
}

type EyebrowProps = HTMLAttributes<HTMLElement> & {
  /** Element to render; `span` by default. */
  as?: "span" | "p" | "div" | "dt" | "h2" | "h3" | "h4" | "label";
  tone?: EyebrowTone;
  /** Only meaningful with `as="label"`. */
  htmlFor?: string;
};

export function Eyebrow({ as: Comp = "span", tone, className, ...props }: Readonly<EyebrowProps>) {
  return <Comp className={cn(eyebrowClass(tone), className)} {...props} />;
}
