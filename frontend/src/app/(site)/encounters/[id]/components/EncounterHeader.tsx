import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { Encounter, EncounterTeam } from "@/types/encounter.types";
import { TeamLogo } from "@/components/TeamName";
import { acceptedScore } from "@/components/pick-ban/pick-ban-model";
import { buildSeriesSlots, getSeriesVerdict, type SeriesSlot } from "@/lib/encounter/detail";
import { duelSeats, seatTeam, type Duel, type DuelSlot } from "@/lib/encounter/seats";
import styles from "@/components/match/EncounterDetail.module.css";

export type EncounterHeaderFact = { label: string; value: string; sub?: string };

/**
 * The match, stated once: where it sits, who played, the result, and the few
 * facts about the series. The hero and the scoreboard under it used to say the
 * same thing three times — "A vs B" as a title, "A took the series 3–2" as a
 * lede, then the 3:2 board — before the page reached any content.
 */
export default function EncounterHeader({
  encounter,
  crumbs,
  actions,
  pills,
  facts
}: Readonly<{
  encounter: Encounter;
  crumbs: ReactNode;
  actions: ReactNode;
  /** Chips for states that want attention; nothing is rendered without one. */
  pills?: ReactNode;
  facts: EncounterHeaderFact[];
}>) {
  const t = useTranslations();
  const slots = buildSeriesSlots(encounter);
  const verdict = getSeriesVerdict(encounter);
  const [seatOne, seatTwo] = duelSeats(encounter.teams);
  const names = {
    one: seatOne?.name ?? t("common.tbd"),
    two: seatTwo?.name ?? t("common.tbd")
  };

  return (
    <header className={cn(styles.card, styles.header)}>
      <div className={styles.headerTop}>
        <div className={styles.headerCrumbs}>{crumbs}</div>
        <div className={styles.heroActions}>{actions}</div>
      </div>

      {/* The page's one h1: the matchup, read by the outline the way the old
          hero title was, while the board below draws it. */}
      <h1 className="sr-only">
        {t("encounters.detail.heroTitle", { first: names.one, second: names.two })}
      </h1>
      <div className={styles.board}>
        <TeamBlock seat={seatOne} slot={1} />
        <div className={styles.boardCenter}>
          <p className={styles.boardScore}>
            <span className={styles.scoreOne}>{seatOne?.score ?? 0}</span>
            <span aria-hidden className={styles.scoreSep}>
              :
            </span>
            <span className={styles.scoreTwo}>{seatTwo?.score ?? 0}</span>
          </p>
          <p className={styles.boardVerdict}>
            {verdict.outcome === "win"
              ? t("encounters.detail.verdictWin", {
                  team: verdict.winner === 1 ? names.one : names.two
                })
              : verdict.outcome === "draw"
                ? t("encounters.detail.verdictDraw")
                : t("encounters.detail.verdictPending")}
          </p>
          <MapPips slots={slots} teams={encounter.teams} names={names} />
        </div>
        <TeamBlock seat={seatTwo} slot={2} />
      </div>

      <div className={styles.headerFoot}>
        {pills ? <div className={styles.boardTags}>{pills}</div> : null}
        {facts.length > 0 ? (
          <dl className={styles.headerFacts}>
            {facts.map((fact) => (
              <div key={fact.label} className={styles.headerFact}>
                <dt className={styles.label}>{fact.label}</dt>
                <dd className={styles.headerFactValue}>
                  {fact.value}
                  {fact.sub ? <span className={styles.headerFactSub}>{fact.sub}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </header>
  );
}

function TeamBlock({
  seat,
  slot
}: Readonly<{ seat: EncounterTeam | null; slot: DuelSlot }>) {
  const t = useTranslations();
  const meta = [
    seat?.team?.placement != null
      ? `${t("encounters.detail.placementShort")} #${seat.team.placement}`
      : null,
    seat?.team?.group?.name ? `${t("common.group")} ${seat.team.group.name}` : null
  ].filter(Boolean);

  return (
    <div
      className={cn(
        styles.boardSide,
        slot === 1 ? styles.slotOne : styles.slotTwo,
        slot === 2 && styles.boardSlotTwo
      )}
    >
      <TeamLogo team={seatTeam(seat)} size="xl" />
      <div className={styles.boardIdentity}>
        {/* Not a heading: a scoreboard label. The h1 above names the matchup. */}
        <p className={styles.boardName}>{seat?.name ?? t("common.tbd")}</p>
        {/* Plain text, not chips: the winner is already the verdict and the pips. */}
        {meta.length > 0 ? <p className={styles.boardMeta}>{meta.join(" · ")}</p> : null}
      </div>
    </div>
  );
}

/** Played: a parsed log or an accepted result — the page's own rule. */
function isPlayed(slot: SeriesSlot, teams: Encounter["teams"]): boolean {
  return slot.match != null || acceptedScore(slot.game, teams) != null;
}

/**
 * Pip hue, in the same precedence the aria summary below reads out: in-progress
 * first, then never-played, then the winner's side, then a tie.
 */
function pipToneClass(slot: SeriesSlot, teams: Encounter["teams"]): string {
  if (slot.isLive) return styles.pipLive;
  if (!isPlayed(slot, teams)) return styles.pipEmpty;
  if (slot.winner === 1) return styles.pipOne;
  if (slot.winner === 2) return styles.pipTwo;
  return styles.pipDraw;
}

/**
 * One pip per slot of the format: filled in the winner's hue, hollow for a map
 * the series never needed, ringed for the map in progress. This is what makes a
 * 3–1 in a Bo5 legible as "four maps played, one spare".
 */
function MapPips({
  slots,
  teams,
  names
}: Readonly<{ slots: SeriesSlot[]; teams: Encounter["teams"]; names: Duel<string> }>) {
  const t = useTranslations();
  const summary = slots
    .map((slot) => {
      if (slot.isLive) return t("encounters.state.live");
      if (!isPlayed(slot, teams)) return t("encounters.detail.pipUnplayed");
      if (!slot.winner) return t("encounters.detail.tie");
      return slot.winner === 1 ? names.one : names.two;
    })
    .join(", ");

  return (
    <div
      className={styles.boardPips}
      role="img"
      aria-label={t("encounters.detail.pipsAria", { summary })}
    >
      {slots.map((slot) => (
        <span key={slot.index} aria-hidden className={cn(styles.pip, pipToneClass(slot, teams))} />
      ))}
    </div>
  );
}
