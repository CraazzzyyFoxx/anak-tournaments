"use client";

import { useTranslations } from "next-intl";

import type { Encounter } from "@/types/encounter.types";

import { MatchCard } from "../../_components/MatchCard";
import { MatchRow } from "../../_components/MatchRow";
import { TournamentPageState } from "../../_components/TournamentPageState";
import { selectOverviewMatchLists } from "../tournamentOverview.model";
import type { OverviewMatchPresenter } from "../useOverviewMatchPresenter";
import { OverviewSection, SectionLink } from "./OverviewCards";

/**
 * ⑤ Live first, as cards; nothing live falls back to the schedule, and
 * without a schedule to the last results, as framed rows.
 */
export function OverviewMatchBlock({
  encounters,
  clockNow,
  overviewHref,
  presenter
}: Readonly<{
  encounters: readonly Encounter[];
  clockNow: number | null;
  overviewHref: string;
  presenter: OverviewMatchPresenter;
}>) {
  const t = useTranslations();
  const { live, upcoming, recent, pending } = selectOverviewMatchLists(encounters, clockNow);

  const matchRows = (rows: Encounter[], withTime: boolean) => (
    <div>
      {rows.map((encounter) => (
        <MatchRow
          key={encounter.id}
          encounter={encounter}
          leading={
            (withTime ? presenter.clock(encounter.scheduled_at) : null) ??
            presenter.encounterRound(encounter)
          }
          trailing={encounter.best_of ? `Bo${encounter.best_of}` : undefined}
          bracketHref={presenter.bracketHref(encounter)}
          returnTo={overviewHref}
        />
      ))}
    </div>
  );

  const section = (title: string, href: string, body: React.ReactNode, framed: boolean) => (
    <OverviewSection
      title={title}
      action={<SectionLink href={href}>{t("tournamentDetail.overview.live.all")}</SectionLink>}
      framed={framed}
    >
      {body}
    </OverviewSection>
  );

  if (live.length > 0) {
    // Match cards are boxes of their own: no frame around them (DESIGN §5).
    return section(
      t("tournamentDetail.overview.live.title"),
      `${overviewHref}/matches`,
      <div className="grid gap-2 sm:grid-cols-2">
        {live.map((encounter) => (
          <MatchCard
            key={encounter.id}
            encounter={encounter}
            eyebrow={presenter.eyebrowOf(encounter)}
            href={presenter.bracketHref(encounter)}
            streamsCount={presenter.streamsCountOf(encounter)}
          />
        ))}
      </div>,
      false
    );
  }
  if (upcoming.length > 0) {
    return section(
      t("tournamentDetail.overview.upcoming.title"),
      `${overviewHref}/matches?view=time`,
      matchRows(upcoming, true),
      true
    );
  }
  if (recent.length > 0) {
    return section(
      t("tournamentDetail.overview.recent.title"),
      `${overviewHref}/matches`,
      matchRows(recent, false),
      true
    );
  }
  if (pending.length > 0) {
    return section(
      t("tournamentDetail.overview.upcoming.title"),
      `${overviewHref}/matches`,
      matchRows(pending, false),
      true
    );
  }
  return (
    <TournamentPageState
      state="empty"
      title={t("tournamentDetail.overview.empty.title")}
      description={t("tournamentDetail.overview.empty.description")}
    />
  );
}
