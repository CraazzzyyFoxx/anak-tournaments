"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import type { Team } from "@/types/team.types";
import { ChallongeTeamSync } from "./teams-tab/ChallongeTeamSync";
import { useTeamColumns } from "./teams-tab/useTeamColumns";

interface TournamentTeamsTabProps {
  tournamentId: number;
  teams: Team[];
  hasChallongeSource: boolean;
  /** `team.create`: the Challonge sync and the balancer both write teams. */
  canImportTeams: boolean;
}

/** Teams › Roster (T2): the tournament's teams; a row opens the team page. */
export function TournamentTeamsTab({
  tournamentId,
  teams,
  hasChallongeSource,
  canImportTeams
}: Readonly<TournamentTeamsTabProps>) {
  const t = useTranslations("adminTournament.teams");
  const router = useRouter();
  const columns = useTeamColumns();

  return (
    <DataTable
      rows={teams}
      columns={columns}
      getRowId={(team) => String(team.id)}
      searchPlaceholder={t("searchTeamsPlayers")}
      rowUnit="teams"
      onRowClick={(row) => router.push(`/admin/teams/${row.original.id}`)}
      emptyMessage={t("empty")}
      actions={
        <>
          {/* The mapping dialog portals out, so only the button lands in this row. */}
          <ChallongeTeamSync
            tournamentId={tournamentId}
            hasChallongeSource={hasChallongeSource}
            canImportTeams={canImportTeams}
          />
          {canImportTeams ? (
            <Button asChild variant="outline" size="sm">
              {/* D30/A-O2: the sole UI entry to the balancer tool after the shell removal (v3.1). */}
              <Link href={`/balancer?tournament=${tournamentId}`}>{t("openBalancer")}</Link>
            </Button>
          ) : null}
        </>
      }
    />
  );
}
