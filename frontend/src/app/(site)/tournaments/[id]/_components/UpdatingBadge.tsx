"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import styles from "../TournamentDetail.module.css";

/**
 * The "a background refresh is in flight" affordance for every tournament data
 * page. It was copied byte-for-byte into five pages; a single definition keeps
 * the one polite live region, the one accessible name and the
 * reduced-motion-safe spinner from drifting apart.
 */
export function UpdatingBadge() {
  const t = useTranslations();
  const label = t("tournamentDetail.pageState.updating");

  return (
    <span className={styles.updatingBadge} role="status" aria-live="polite" aria-label={label}>
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
    </span>
  );
}
