import React from "react";

import { cn } from "@/lib/utils";
import styles from "@/components/match/EncounterDetail.module.css";

/**
 * Presentational atoms shared by the encounter detail page. No hooks, so they
 * render from both the server page and its client panels.
 */

/** Label-over-value block used by the hairline fact strips. */
export function Fact({
  label,
  children,
  className
}: Readonly<{
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <div className={cn(styles.fact, className)}>
      <span className={styles.label}>{label}</span>
      <span className={styles.factValue}>{children}</span>
    </div>
  );
}
