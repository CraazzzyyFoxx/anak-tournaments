"use client";

import { Award, Scale, Trophy, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import StatisticsCard from "@/components/StatisticsCard";
import { cn } from "@/lib/utils";

export interface PlatformTotals {
  tournaments: number;
  teams: number;
  players: number;
  champions: number;
}

/**
 * The platform headline totals: tournaments held, teams balanced, players
 * participated, champions.
 *
 * This exact four-tile block was written out three times — on the home
 * dashboard, on `/statistics` and on the workspace page — and the tournaments
 * hero derived its own competing numbers from a different endpoint, so two
 * adjacent public pages stated different totals for the same platform. There is
 * now one component and one source (`statisticsService.getOverallStatistics`).
 */
export function PlatformStatsGrid({
  totals,
  className
}: {
  totals: PlatformTotals;
  className?: string;
}) {
  const t = useTranslations();

  return (
    <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-4", className)}>
      <StatisticsCard
        name={t("statistics.statTournamentsHeld")}
        value={totals.tournaments}
        icon={<Trophy className="h-4 w-4" aria-hidden />}
        iconClassName="bg-[color:color-mix(in_srgb,var(--aqt-violet)_12%,transparent)] text-[color:var(--aqt-violet)]"
      />
      <StatisticsCard
        name={t("statistics.statTeamsBalanced")}
        value={totals.teams}
        icon={<Scale className="h-4 w-4" aria-hidden />}
        iconClassName="bg-[color:color-mix(in_srgb,var(--aqt-blue)_12%,transparent)] text-[color:var(--aqt-blue)]"
      />
      <StatisticsCard
        name={t("statistics.statPlayersParticipated")}
        value={totals.players}
        icon={<Users className="h-4 w-4" aria-hidden />}
        iconClassName="bg-[color:color-mix(in_srgb,var(--aqt-emerald)_12%,transparent)] text-[color:var(--aqt-emerald)]"
      />
      <StatisticsCard
        name={t("common.champions")}
        value={totals.champions}
        icon={<Award className="h-4 w-4" aria-hidden />}
        iconClassName="bg-[color:color-mix(in_srgb,var(--aqt-amber)_12%,transparent)] text-[color:var(--aqt-amber)]"
      />
    </div>
  );
}
