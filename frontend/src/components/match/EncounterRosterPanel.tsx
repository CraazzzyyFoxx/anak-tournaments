"use client";

import { useTranslations } from "next-intl";

import { TournamentTeamCardFrame, TournamentTeamTable } from "@/components/TournamentTeamCard";
import TeamName from "@/components/TeamName";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import type { Team } from "@/types/team.types";
import type { DivisionGridVersion } from "@/types/workspace.types";

/**
 * One seat's roster for an encounter (encounter page, pre-game room, bracket
 * rosters modal): the Teams-page card without group and placement, with the
 * seat's colour on top. `team` is null while the slot is still TBD.
 * `workspaceId` + `discipline` are the encounter's owner game: its ontology
 * draws the role column (absent, every role renders as "?").
 */
export default function EncounterRosterPanel({
  team,
  slot,
  workspaceId,
  discipline,
  tournamentGrid
}: Readonly<{
  team: Team | null;
  slot: 1 | 2;
  workspaceId: number;
  discipline: string;
  tournamentGrid?: DivisionGridVersion | null;
}>) {
  const t = useTranslations();
  const ontology = useDisciplineMetadata(workspaceId, discipline).data ?? null;

  return (
    <TournamentTeamCardFrame
      slot={slot}
      name={<TeamName team={team} fallback={t("common.tbd")} size="md" />}
      metricLabel={team ? t("teams.roster.avgSr") : undefined}
      metricValue={
        team ? <span className="tabular-nums">{team.avg_sr.toFixed(0)}</span> : undefined
      }
    >
      {team && team.players.length > 0 ? (
        <TournamentTeamTable
          players={team.players}
          tournamentGrid={tournamentGrid}
          discipline={discipline}
          ontology={ontology}
          captainUserId={team.captain_id}
        />
      ) : (
        <p className="px-3.5 py-3 text-sm text-[color:var(--aqt-fg-dim)]">{t("common.noData")}</p>
      )}
    </TournamentTeamCardFrame>
  );
}
