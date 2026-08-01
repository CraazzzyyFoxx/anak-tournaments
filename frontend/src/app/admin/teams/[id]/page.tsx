"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2, Trophy, Users } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { InlineEditText } from "@/components/admin/InlineEditText";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { TeamRosterEditor } from "@/components/admin/teams/TeamRosterEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import adminService from "@/services/admin.service";
import type { Player, Team } from "@/types/team.types";
import type { Tournament } from "@/types/tournament.types";
import type { User } from "@/types/user.types";

type AdminTeamDetail = Team & {
  captain?: User | null;
  tournament?: Tournament | null;
  players: Player[];
};

/** Roster members eligible to captain the team, deduplicated by linked user. */
function buildCaptainOptions(team: AdminTeamDetail) {
  const options = new Map<number, string>();

  for (const player of team.players ?? []) {
    if (player.user_id > 0 && !options.has(player.user_id)) {
      options.set(player.user_id, player.user?.name ?? player.name);
    }
  }

  // A captain inherited from before this rule existed may sit outside the roster.
  // Keep them selectable so the field shows who it actually is.
  if (team.captain_id > 0 && !options.has(team.captain_id)) {
    options.set(team.captain_id, `${team.captain?.name ?? `User #${team.captain_id}`} (off roster)`);
  }

  return Array.from(options, ([userId, label]) => ({ userId, label }));
}

/**
 * The team page is the team editor.
 *
 * Name, captain and every roster row are edited here and persist on change, so
 * opening a team lands directly on the thing an operator came to change instead
 * of a read-only summary behind an "Edit" dialog.
 */
export default function AdminTeamWorkspacePage() {
  const params = useParams<{ id: string }>();
  const teamId = Number(params.id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { canAccessPermission } = usePermissions();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const teamQuery = useQuery({
    queryKey: ["admin", "team", teamId],
    queryFn: () => adminService.getTeam(teamId) as Promise<AdminTeamDetail>,
    enabled: Number.isFinite(teamId)
  });

  const team = teamQuery.data;
  const workspaceId = team?.tournament?.workspace_id ?? null;
  const canUpdateTeam = canAccessPermission("team.update", workspaceId);
  const canDeleteTeam = canAccessPermission("team.delete", workspaceId);
  const canCreatePlayer = canAccessPermission("player.create", workspaceId);
  const canUpdatePlayer = canAccessPermission("player.update", workspaceId);
  const canDeletePlayer = canAccessPermission("player.delete", workspaceId);

  const captainOptions = useMemo(() => (team ? buildCaptainOptions(team) : []), [team]);

  const updateTeam = useMutation({
    mutationFn: (payload: { name?: string; captain_id?: number }) =>
      adminService.updateTeam(teamId, payload),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "team", teamId] }),
        queryClient.invalidateQueries({ queryKey: ["teams"] })
      ])
  });

  const deleteTeam = useMutation({
    mutationFn: () => adminService.deleteTeam(teamId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
      router.push(
        team?.tournament_id ? `/admin/teams?tournament=${team.tournament_id}` : "/admin/teams"
      );
    }
  });

  if (teamQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full rounded-xl" />
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
            This team may have been deleted.{" "}
            <Link href="/admin/teams" className="underline">
              Go back to the teams list
            </Link>{" "}
            and pick another roster.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const substitutes = team.players?.filter((player) => player.is_substitution).length ?? 0;
  const starters = (team.players?.length ?? 0) - substitutes;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={team.name}
        titleHidden
        meta={
          <InlineEditText
            value={team.name}
            label="team name"
            canEdit={canUpdateTeam}
            onSave={(name) => updateTeam.mutateAsync({ name })}
            textClassName="text-lg font-semibold tracking-tight text-foreground"
          />
        }
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
              <Link href={`/admin/teams?tournament=${team.tournament_id}`}>
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
            {canDeleteTeam ? (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                Delete team
              </Button>
            ) : null}
          </div>
        }
      />

      <StatTileGrid>
        <StatTile label="Average SR" value={team.avg_sr.toFixed(0)} detail="Starters only" />
        <StatTile label="Total SR" value={team.total_sr} detail="Combined starter SR" />
        <StatTile
          label="Roster"
          value={starters}
          detail={substitutes ? `+${substitutes} substitutes` : "No substitutes"}
          icon={Users}
          tone="info"
        />
        <StatTile
          label="Group"
          value={team.group?.name ?? "—"}
          detail={team.placement != null ? `Placement #${team.placement}` : "No placement yet"}
        />
      </StatTileGrid>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-4">
          <div>
            <CardTitle asChild>
              <h2>Roster</h2>
            </CardTitle>
            <CardDescription>
              Role, rank, sub-role and flags save as you change them.
            </CardDescription>
          </div>
          <div className="w-full max-w-xs space-y-1.5">
            <Label htmlFor="team-captain">Captain</Label>
            <Select
              value={team.captain_id > 0 ? String(team.captain_id) : ""}
              disabled={!canUpdateTeam || captainOptions.length === 0}
              onValueChange={(value) =>
                updateTeam.mutate({ captain_id: Number.parseInt(value, 10) })
              }
            >
              <SelectTrigger id="team-captain">
                <SelectValue placeholder="Select captain from roster" />
              </SelectTrigger>
              <SelectContent>
                {captainOptions.map((option) => (
                  <SelectItem key={option.userId} value={String(option.userId)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <TeamRosterEditor
            teamId={team.id}
            tournamentId={team.tournament_id}
            workspaceId={workspaceId}
            players={team.players ?? []}
            divisionGrid={team.tournament?.division_grid_version ?? null}
            canCreatePlayer={canCreatePlayer}
            canUpdatePlayer={canUpdatePlayer}
            canDeletePlayer={canDeletePlayer}
          />
        </CardContent>
      </Card>

      {canDeleteTeam ? (
        <DeleteConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={() => deleteTeam.mutate()}
          title={`Delete ${team.name}`}
          description={`Deleting “${team.name}” removes the roster from ${team.tournament?.name ?? "its tournament"} along with every player and match statistic below. This cannot be undone.`}
          cascadeInfo={["All players in this team", "All related match statistics"]}
          isDeleting={deleteTeam.isPending}
        />
      ) : null}
    </div>
  );
}
