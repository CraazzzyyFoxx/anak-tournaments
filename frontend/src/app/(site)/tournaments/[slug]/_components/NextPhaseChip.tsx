"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { useMinuteClock } from "@/hooks/useMinuteClock";
import { cn } from "@/lib/utils";
import type { Tournament } from "@/types/tournament.types";

import { nextPhaseBoundary } from "../_views/tournamentSchedule.model";

type NextPhaseChipProps = {
  tournament: Pick<
    Tournament,
    "status" | "team_formation" | "phase_schedule" | "auto_transitions_enabled"
  >;
  /** Where the chip leads — the overview's phase timeline. */
  href: string;
  className?: string;
};

/**
 * "→ Check-in · Sat 14:00 · in 1d 6h": the one question a viewer has during
 * registration, answered in the header of every section. Renders nothing when
 * no boundary lies ahead, so a finished tournament carries no stale promise.
 */
export function NextPhaseChip({ tournament, href, className }: Readonly<NextPhaseChipProps>) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useMinuteClock();

  if (now === null) return null;
  const next = nextPhaseBoundary({ tournament, now });
  if (!next) return null;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const at = new Date(next.at);
  const stamp = format.dateTime(at, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone
  });
  const relative = format.relativeTime(at, now);
  const phase = t(`common.statusBadge.${next.status}`);
  const label =
    next.kind === "close"
      ? t("tournamentDetail.nextPhase.closes", { phase })
      : t("tournamentDetail.nextPhase.starts", { phase });

  return (
    <Link
      href={href}
      className={cn(
        "meta-pill transition-colors hover:border-[color:var(--aqt-teal)]",
        className
      )}
    >
      <span className="k">{label}</span>
      <span className="v aqt-tnum">
        <time dateTime={next.at}>{stamp}</time>
        <span className="opacity-60"> · {relative}</span>
      </span>
    </Link>
  );
}
