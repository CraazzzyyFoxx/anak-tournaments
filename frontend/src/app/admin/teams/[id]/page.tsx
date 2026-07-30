"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowLeftRight,
  Pencil,
  Shield,
  Sparkles,
  Trophy,
  Users
} from "lucide-react";

import { AdminDetailTableShell, getAdminDetailTableStyles } from "@/components/admin/AdminDetailTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { TeamRosterEditorDialog } from "@/components/admin/teams/TeamRosterEditorDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import type { Team, Player } from "@/types/team.types";
import type { Tournament } from "@/types/tournament.types";
import type { User } from "@/types/user.types";
import { formatSubRoleLabel } from "@/utils/player";

type AdminTeamDetail = Team & {
  captain?: User | null;
  tournament?: Tournament | null;
  players: (Player & { user?: User | null })[];
};

export default function AdminTeamWorkspacePage() {
  const params = useParams<{ id: string }>();
  const teamId = Number(params.id);
  const tableStyles = getAdminDetailTableStyles("comfortable");
  const [editorOpen, setEditorOpen] = useState(false);
  const { canAccessPermission } = usePermissions();

  const teamQuery = useQuery({
    queryKey: ["admin", "team", teamId],
    queryFn: () => adminService.getTeam(teamId) as Promise<AdminTeamDetail>,
    enabled: Number.isFinite(teamId)
  });

  const team = teamQuery.data;
  const workspaceId = team?.tournament?.workspace_id ?? null;
  const canUpdateTeam = canAccessPermission("team.update", workspaceId);
  const canCreateTeam = canAccessPermission("team.create", workspaceId);
  const canCreatePlayer = canAccessPermission("player.create", workspaceId);
  const canUpdatePlayer = canAccessPermission("player.update", workspaceId);
  const canDeletePlayer = canAccessPermission("player.delete", workspaceId);
  const canOpenEditor = canUpdateTeam || canCreatePlayer || canUpdatePlayer || canDeletePlayer;

  if (teamQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  if (!team) {
    return (
      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h1>Team not found</h1>
          </CardTitle>
          <CardDescription>
            This team may have been deleted. Go back to the teams list and pick another roster.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={team.name}
        description="Roster details, captain ownership, and tournament context for this team."
        meta={<Badge variant="secondary">Roster control</Badge>}
        footer={
          <p className="text-sm text-muted-foreground">
            {team.tournament ? (
              <>
                {team.tournament.name}
                {" · "}
                <span className="tabular-nums">
                  {new Date(team.tournament.start_date).toLocaleDateString()} –{" "}
                  {new Date(team.tournament.end_date).toLocaleDateString()}
                </span>
              </>
            ) : (
              "No linked tournament loaded."
            )}
          </p>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/teams">
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                Back to teams
              </Link>
            </Button>
            {team.tournament ? (
              <Button asChild variant="outline">
                <Link href={`/admin/tournaments/${team.tournament.id}`}>
                  <Trophy className="mr-2 h-4 w-4" aria-hidden />
                  Open tournament
                </Link>
              </Button>
            ) : null}
            {canOpenEditor ? (
              <Button onClick={() => setEditorOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" aria-hidden />
                Edit team
              </Button>
            ) : null}
          </div>
        }
      />

      <StatTileGrid>
        <StatTile
          label="Average SR"
          value={team.avg_sr.toFixed(0)}
          detail="Balanced roster average"
        />
        <StatTile label="Total SR" value={team.total_sr} detail="Combined current roster SR" />
        <StatTile
          label="Roster size"
          value={team.players?.length ?? 0}
          detail="Players assigned to this team"
          icon={Users}
          tone="info"
        />
        <StatTile
          label="Captain"
          value={team.captain?.name ?? `User #${team.captain?.id}`}
          detail="Owns this roster"
          icon={Shield}
          tone="accent"
        />
      </StatTileGrid>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle asChild>
              <h2>Roster</h2>
            </CardTitle>
            <CardDescription>Current players assigned to this team.</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminDetailTableShell variant="comfortable">
              <Table>
                <TableHeader>
                  <TableRow className={tableStyles.headerRow}>
                    <TableHead className={tableStyles.head}>Player</TableHead>
                    <TableHead className={tableStyles.head}>Role</TableHead>
                    <TableHead className={tableStyles.head}>Sub-role</TableHead>
                    <TableHead className={tableStyles.head}>Rank / Div</TableHead>
                    <TableHead className={tableStyles.head}>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.players?.length ? (
                    team.players.map((player) => (
                      <TableRow key={player.id} className={tableStyles.row}>
                        <TableCell className={tableStyles.cell}>
                          <div className="font-medium">{player.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {player.user?.name
                              ? `Linked user: ${player.user.name}`
                              : `User ID: ${player.user_id}`}
                          </div>
                        </TableCell>
                        <TableCell className={tableStyles.cell}>
                          <Badge variant="outline" className="capitalize">
                            {player.role}
                          </Badge>
                        </TableCell>
                        <TableCell className={tableStyles.cell}>
                          {formatSubRoleLabel(player.sub_role) ?? "—"}
                        </TableCell>
                        <TableCell className={tableStyles.numericCell}>
                          {player.rank} / {player.division}
                        </TableCell>
                        <TableCell className={tableStyles.cell}>
                          <div className="flex flex-wrap gap-2">
                            {player.is_newcomer ? (
                              <StatusIcon icon={Sparkles} label="Newcomer" variant="warning" />
                            ) : null}
                            {player.is_substitution ? (
                              <StatusIcon
                                icon={ArrowLeftRight}
                                label="Substitute"
                                variant="info"
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className={tableStyles.row}>
                      <TableCell className={tableStyles.cell} colSpan={5}>
                        No players on this roster yet. Use “Edit team” to add the first player.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </AdminDetailTableShell>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle asChild>
              <h2>Quick links</h2>
            </CardTitle>
            <CardDescription>Jump back into the larger operations flows.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild variant="outline" className="justify-start">
              <Link href={`/admin/teams?tournament=${team.tournament_id}`}>Open teams list</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/players">Manage players</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/encounters">Manage encounters</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <TeamRosterEditorDialog
        key={`team-detail-edit-${team.id}-${editorOpen ? "open" : "closed"}`}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        mode="edit"
        tournamentId={team.tournament_id}
        workspaceId={workspaceId}
        team={team}
        canCreateTeam={canCreateTeam}
        canUpdateTeam={canUpdateTeam}
        canCreatePlayer={canCreatePlayer}
        canUpdatePlayer={canUpdatePlayer}
        canDeletePlayer={canDeletePlayer}
      />
    </div>
  );
}
