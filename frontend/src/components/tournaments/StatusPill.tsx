import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

/**
 * Presentation buckets for tournament-domain lifecycle state. `live`,
 * `upcoming`, `finished` and `draft` are the four `TOURNAMENT_STATUS_META`
 * variants; `open` and `upset` are encounter-only states (`EncounterState`,
 * `isUpset`) that the encounters table has always drawn as the same pill.
 */
export type TournamentStatusVariant =
  | "live"
  | "upcoming"
  | "finished"
  | "draft"
  | "open"
  | "upset";

// The hue `Badge palette="aqt"` tints with, off the `--aqt-status-*` tokens
// (design-book §1). `open`/`upset` have no status token of their own and borrow
// the accent they have always used.
const STATUS_HUE: Record<TournamentStatusVariant, string> = {
  live: "[--badge-hue:var(--aqt-status-live)]",
  upcoming: "[--badge-hue:var(--aqt-status-upcoming)]",
  finished: "[--badge-hue:var(--aqt-status-finished)]",
  draft: "[--badge-hue:var(--aqt-status-draft)]",
  open: "[--badge-hue:var(--aqt-teal)]",
  upset: "[--badge-hue:var(--aqt-violet)]"
};

export interface TournamentStatusPillProps extends ComponentPropsWithoutRef<"span"> {
  status: TournamentStatusVariant;
  /**
   * The label. Required, and never derived here: every surface phrases the same
   * state differently — "Live · Grand Final", "Live · 3", `stream.status.live`,
   * `encounters.state.live`, `common.statusBadge.playoffs`. The status is the
   * visual fact, the copy belongs to the screen.
   */
  children: ReactNode;
}

/**
 * The one lifecycle status pill: tournaments, encounters and streams.
 *
 * It replaces the `.status-pill` global class family, `EncountersTable.module.css`'s
 * `.statusPill`, and the raw `className="status-pill live"` strings — three
 * implementations of the same pill that disagreed on weight, tracking and
 * radius, and of which only the global one was scoped to `.aqt-tn` (so it
 * silently rendered unstyled anywhere else).
 *
 * `live` carries the pulsing dot on its own: every call site that drew one drew
 * it for exactly that state, and the dot is decorative — the label beside it is
 * what says "live".
 */
export function TournamentStatusPill({
  status,
  children,
  className,
  ...props
}: Readonly<TournamentStatusPillProps>) {
  return (
    <Badge palette="aqt" voice="label" className={cn(STATUS_HUE[status], className)} {...props}>
      {status === "live" ? (
        <StatusDot
          pulse
          className="size-[7px] shadow-[0_0_0_3px_color-mix(in_srgb,var(--aqt-status-live)_18%,transparent)]"
        />
      ) : null}
      {children}
    </Badge>
  );
}
