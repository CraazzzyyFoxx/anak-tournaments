import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import styles from "../TournamentDetail.module.css";

export type SectionToolbarProps = {
  /** Filter chips, stage switchers — the leading group. */
  children: ReactNode;
  /** Search, sort, view segment — the trailing group, pushed to the end. */
  end?: ReactNode;
  label: string;
  className?: string;
};

/**
 * The one toolbar shape every public tournament section uses: chips on the
 * start, controls on the end, wrapping under itself on narrow screens. Uses the
 * existing `controlRail` rhythm so it sits where the old per-page rails did.
 */
export function SectionToolbar({ children, end, label, className }: Readonly<SectionToolbarProps>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-2 sm:gap-3", className)}
    >
      <div className={cn(styles.controlRail, "min-w-0 flex-1 flex-wrap")}>{children}</div>
      {end ? <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{end}</div> : null}
    </div>
  );
}
