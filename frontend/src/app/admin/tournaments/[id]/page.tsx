"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CalendarDays, Layers3, ShieldAlert, Trophy, Users } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
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
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import adminService from "@/services/admin.service";
import encounterService from "@/services/encounter.service";
import teamService from "@/services/team.service";
import tournamentService from "@/services/tournament.service";

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default function AdminTournamentWorkspacePage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission("tournament.update");

  const tournamentQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId],
    queryFn: () => adminService.getTournament(tournamentId),
    enabled: Number.isFinite(tournamentId),
  });

  const teamsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "teams"],
    queryFn: () => teamService.getAll(tournamentId),
    enabled: Number.isFinite(tournamentId),
  });

  const standingsQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "standings"],
    queryFn: () => tournamentService.getStandings(tournamentId),
    enabled: Number.isFinite(tournamentId),
  });

  const encountersQuery = useQuery({
    queryKey: ["admin", "tournament", tournamentId, "encounters"],
    queryFn: () => encounterService.getAll(1, "", tournamentId),
    enabled: Number.isFinite(tournamentId),
  });

  const toggleFinishedMutation = useMutation({
    mutationFn: () => adminService.toggleTournamentFinished(tournamentId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "tournament", tournamentId] }),
        queryClient.invalidateQueries({ queryKey: ["tournaments"] }),
      ]);
      toast({ title: "Tournament status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const tournament = tournamentQuery.data;
  const teams = teamsQuery.data?.results ?? [];
  const standings = standingsQuery.data ?? [];
  const recentEncounters = encountersQuery.data?.results ?? [];

  if (
    tournamentQuery.isLoading ||
    teamsQuery.isLoading ||
    standingsQuery.isLoading ||
    encountersQuery.isLoading
  ) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tournament not found</CardTitle>
          <CardDescription>The requested admin workspace could not be loaded.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={tournament.name}
        description="Tournament workspace with operational summary, groups, standings, and recent encounters."
        eyebrow="Tournament Workspace"
        meta={
          <Badge variant={tournament.is_finished ? "outline" : "secondary"}>
            {tournament.is_finished ? "Finished" : "Live ops"}
          </Badge>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/tournaments">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Tournaments
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/teams">
                <Users className="mr-2 h-4 w-4" />
                Open Teams
              </Link>
            </Button>
            {canUpdate ? (
              <Button onClick={() => toggleFinishedMutation.mutate()} disabled={toggleFinishedMutation.isPending}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {tournament.is_finished ? "Reopen Tournament" : "Mark as Finished"}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
              {tournament.is_finished ? "Finished" : "Active"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={tournament.is_finished ? "outline" : "default"}>
              {tournament.is_league ? "League" : "Tournament"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Date Window</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              {formatDate(tournament.start_date)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Ends {formatDate(tournament.end_date)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Participants</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Users className="h-5 w-5 text-muted-foreground" />
              {tournament.participants_count ?? teams.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {teams.length} teams loaded in admin view
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Groups</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Layers3 className="h-5 w-5 text-muted-foreground" />
              {tournament.groups?.length ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {recentEncounters.length} recent encounters in preview
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Groups</CardTitle>
            <CardDescription>Configured tournament groups and bracket structure.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {tournament.groups?.length ? (
              tournament.groups.map((group) => (
                <div key={group.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="font-medium">{group.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Challonge slug: {group.challonge_slug || "—"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {group.is_groups ? <Badge variant="secondary">Groups</Badge> : null}
                    {group.is_playoffs ? <Badge variant="outline">Playoffs</Badge> : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No groups configured yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Links</CardTitle>
            <CardDescription>Jump into the operational pages that manage this tournament.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/teams">Manage Teams</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/players">Manage Players</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/encounters">Manage Encounters</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/standings">Manage Standings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Team Snapshot</CardTitle>
            <CardDescription>Top teams in this tournament by average SR.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Avg SR</TableHead>
                  <TableHead>Total SR</TableHead>
                  <TableHead>Players</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.slice(0, 8).map((team) => (
                  <TableRow key={team.id}>
                    <TableCell>
                      <Link className="font-medium hover:underline" href={`/admin/teams/${team.id}`}>
                        {team.name}
                      </Link>
                    </TableCell>
                    <TableCell>{team.avg_sr.toFixed(0)}</TableCell>
                    <TableCell>{team.total_sr}</TableCell>
                    <TableCell>{team.players?.length ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Standings Preview</CardTitle>
            <CardDescription>Top placements from the current standings snapshot.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pos</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Record</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standings.slice(0, 8).map((standing) => (
                  <TableRow key={`${standing.team_id}-${standing.group_id}`}>
                    <TableCell>{standing.position}</TableCell>
                    <TableCell className="font-medium">{standing.team?.name ?? "—"}</TableCell>
                    <TableCell>{standing.points}</TableCell>
                    <TableCell>
                      {standing.win}-{standing.draw}-{standing.lose}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Encounters</CardTitle>
          <CardDescription>Latest encounter records loaded for this tournament.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Encounter</TableHead>
                <TableHead>Round</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Logs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentEncounters.slice(0, 10).map((encounter) => (
                <TableRow key={encounter.id}>
                  <TableCell className="font-medium">{encounter.name}</TableCell>
                  <TableCell>{encounter.round}</TableCell>
                  <TableCell>
                    {encounter.score.home} - {encounter.score.away}
                  </TableCell>
                  <TableCell>
                    {encounter.has_logs ? <Badge variant="default">Available</Badge> : <Badge variant="outline">Missing</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
