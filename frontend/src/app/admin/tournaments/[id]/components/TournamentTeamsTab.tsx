"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ClipboardList,
  Gauge,
  Plus,
  Scale,
  Users
} from "lucide-react";

import { DataTable } from "@/components/data-table";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Team } from "@/types/team.types";
import { ChallongeTeamSync } from "./teams-tab/ChallongeTeamSync";
import { useTeamColumns } from "./teams-tab/useTeamColumns";

interface TournamentTeamsTabProps {
  tournamentId: number;
  teams: Team[];
  stagesCount: number;
  hasChallongeSource: boolean;
  canCreateTeam: boolean;
  canUpdateTeam: boolean;
  canDeleteTeam: boolean;
  canImportTeams: boolean;
  canCreatePlayer: boolean;
  canUpdatePlayer: boolean;
  canDeletePlayer: boolean;
}

export function TournamentTeamsTab({
  tournamentId,
  teams,
  stagesCount,
  hasChallongeSource,
  canCreateTeam,
  canUpdateTeam,
  canDeleteTeam,
  canImportTeams,
  canCreatePlayer,
  canUpdatePlayer,
  canDeletePlayer
}: Readonly<TournamentTeamsTabProps>) {
  const t = useTranslations("adminTournament.teams");
  const tx = useTranslations("adminTournament.teamsExtra");
  const router = useRouter();
  const columns = useTeamColumns();

  const canManageRoster = canCreatePlayer || canUpdatePlayer || canDeletePlayer;
  const canManageTeams = canCreateTeam || canUpdateTeam || canDeleteTeam || canManageRoster;
  const teamsAdminHref = `/admin/teams?tournament=${tournamentId}`;

  const rosterPlayersCount = teams.reduce((sum, team) => sum + team.players.length, 0);
  const teamsWithRosterCount = teams.filter((team) => team.players.length > 0).length;
  const emptyRosterTeamsCount = teams.length - teamsWithRosterCount;
  const averageSr =
    teams.length > 0
      ? Math.round(teams.reduce((sum, team) => sum + team.avg_sr, 0) / teams.length)
      : 0;

  return (
    <>
      <StatTileGrid className="mb-4">
        <StatTile
          label={t("teams")}
          value={teams.length}
          detail={tx("stages", { count: stagesCount })}
          icon={Users}
        />
        <StatTile
          label={t("rosterRecords")}
          value={rosterPlayersCount}
          detail={tx("rosterCount", { withPlayers: teamsWithRosterCount, total: teams.length })}
          icon={ClipboardList}
        />
        <StatTile
          label={t("averageSr")}
          value={teams.length ? averageSr : "—"}
          detail={tx("acrossLoaded")}
          icon={Gauge}
        />
        <StatTile
          label={t("emptyRosters")}
          value={emptyRosterTeamsCount}
          detail={
            emptyRosterTeamsCount > 0
              ? t("playersBeforeSeeding")
              : t("everyTeamHasPlayers")
          }
          icon={AlertTriangle}
          tone={emptyRosterTeamsCount > 0 ? "warning" : "success"}
        />
      </StatTileGrid>

      <Card className="border-border/40">
        <CardHeader className="gap-3 pb-3">
          <div className="min-w-0">
            <CardTitle asChild className="text-base font-semibold">
              <h2>{t("operations")}</h2>
            </CardTitle>
            <CardDescription className="mt-1">
              {t("operationsDescription")}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* The mapping dialog portals out, so only the button lands in this row. */}
            <ChallongeTeamSync
              tournamentId={tournamentId}
              hasChallongeSource={hasChallongeSource}
              canImportTeams={canImportTeams}
            />
            {canImportTeams ? (
              <Button asChild variant="outline">
                {/* D30/A-O2: the sole UI entry to the balancer tool after the shell removal (v3.1). */}
                <Link href={`/balancer?tournament=${tournamentId}`}>
                  <Scale className="mr-2 h-4 w-4" aria-hidden />
                  {t("openBalancer")}
                </Link>
              </Button>
            ) : null}
            {canManageTeams ? (
              <Button asChild>
                <Link href={teamsAdminHref}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  {t("manage")}
                </Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={teams}
            columns={columns}
            getRowId={(team) => String(team.id)}
            searchPlaceholder={t("searchTeamsPlayers")}
            rowUnit="teams"
            onRowClick={(row) => router.push(`/admin/teams/${row.original.id}`)}
            emptyMessage={t("empty")}
          />
        </CardContent>
      </Card>
    </>
  );
}
