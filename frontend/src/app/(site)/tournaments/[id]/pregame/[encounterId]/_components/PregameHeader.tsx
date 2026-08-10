"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Encounter } from "@/types/encounter.types";
import type { PickBanSession } from "@/types/tournament.types";

/** One step of the round the room is on. `map`/`hero` mirror `PickBanKind`. */
export type PregamePhase = "map" | "hero" | "report" | "done";

export interface PregamePhaseStatus {
  phase: PregamePhase;
  done: boolean;
}

interface PregameHeaderProps {
  encounter: Encounter;
  /** Null before both captains are ready -- no session exists yet (see `ReadinessModal`). */
  session: PickBanSession | null;
  activePhase: PregamePhase;
  /**
   * The steps of ONE round of the series, in loop order: the map is picked, its
   * heroes are banned, it is played and reported, and that result opens the
   * next map. Only the steps that apply to this encounter are listed.
   */
  phases: PregamePhaseStatus[];
  /** Which map of the series the room is on, 1-based; null before the first. */
  round: number | null;
}

const STATUS_CHIP_CLASSES: Record<PickBanSession["status"], string> = {
  active: "border-[color:var(--aqt-teal)]/35 bg-[color:var(--aqt-teal)]/12 text-[color:var(--aqt-teal)]",
  completed: "border-[color:var(--aqt-support)]/35 bg-[color:var(--aqt-support)]/12 text-[color:var(--aqt-support)]",
  cancelled: "border-[color:var(--aqt-border-2)] text-[color:var(--aqt-amber)]",
};

/**
 * Shared header content for the unified pre-game room. Renders as bare
 * content (no `Card` of its own) so the caller can embed it as the top of
 * whichever card currently anchors the room -- the Map/Hero Pool card once a
 * session exists, a loading card while one is pending.
 *
 * Renders with `session=null` while the room is open but waiting on captain
 * readiness (`ReadinessModal` overlays this, rather than replacing it) --
 * every session-derived piece (status chip, seeds, first-pick badge) is
 * skipped in that state; the turn timer moved to `PickBanCommandBar`, which
 * only ever renders once a session exists. The "who goes first" banner lives
 * in `PickBanStepTimeline` instead, next to the steps it explains.
 */
export function PregameHeader({ encounter, session, activePhase, phases, round }: PregameHeaderProps) {
  const t = useTranslations("pickBan.room");
  const teamName = (side: "home" | "away") =>
    side === "home" ? (encounter.home_team?.name ?? t("side.home")) : (encounter.away_team?.name ?? t("side.away"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/encounters/${encounter.id}`}
          aria-label={t("back")}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--aqt-fg-muted)] outline-none transition-colors hover:bg-[color:var(--aqt-card-2)] hover:text-[color:var(--aqt-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-onest text-xl font-semibold tracking-[-0.01em]">{t("title")}</h1>
        {session != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]",
              STATUS_CHIP_CLASSES[session.status],
            )}
          >
            {session.status === "active" ? (
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[color:var(--aqt-teal)] animate-pulse motion-reduce:animate-none"
                style={{ boxShadow: "0 0 8px var(--aqt-teal)" }}
              />
            ) : null}
            {t(`statusChip.${session.status}`)}
          </span>
        ) : null}
      </div>

      {phases.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("phase.current")}>
          {round != null ? <Badge variant="outline">{t("round.label", { n: round })}</Badge> : null}
          {phases.map((phase) => (
            <Badge
              key={phase.phase}
              variant={phase.phase === activePhase ? "default" : phase.done ? "secondary" : "outline"}
              className="font-normal"
            >
              {t(`phase.${phase.phase}`)}
              {phase.phase === activePhase ? ` · ${t("phase.current")}` : phase.done ? ` · ${t("phase.done")}` : ""}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <TeamBlock
          name={teamName("home")}
          seed={session?.home_seed ?? null}
          accentVar="--aqt-teal"
          first={session?.first_side === "home"}
        />
        <span className="font-onest text-lg font-semibold text-[color:var(--aqt-fg-faint)]">vs</span>
        <TeamBlock
          name={teamName("away")}
          seed={session?.away_seed ?? null}
          accentVar="--aqt-rose"
          first={session?.first_side === "away"}
        />
      </div>
    </div>
  );
}

function TeamBlock({
  name,
  seed,
  accentVar,
  first,
}: {
  name: string;
  seed: number | null;
  accentVar: "--aqt-teal" | "--aqt-rose";
  first: boolean;
}) {
  const t = useTranslations("pickBan.room");
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate font-onest text-lg font-semibold" style={{ color: `var(${accentVar})` }}>
        {name}
      </span>
      <Badge variant="secondary">{seed != null ? t("seedBadge", { seed }) : t("seedUnknown")}</Badge>
      {first ? (
        <Badge className="border-transparent bg-[color:var(--aqt-teal)]/15 text-[color:var(--aqt-teal)] hover:bg-[color:var(--aqt-teal)]/15">
          1st
        </Badge>
      ) : null}
    </div>
  );
}
