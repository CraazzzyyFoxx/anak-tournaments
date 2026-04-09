"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, Shield, Sparkles, Star, StarHalf, Trophy, UserCircle2, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusIcon } from "@/components/admin/StatusIcon";
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
import adminService from "@/services/admin.service";
import type { Team, Player } from "@/types/team.types";
import type { Tournament } from "@/types/tournament.types";
import type { User } from "@/types/user.types";

type AdminTeamDetail = Team & {
  captain?: User | null;
  tournament?: Tournament | null;
  players: (Player & { user?: User | null })[];
};

const adminDetailTableShell = "overflow-hidden rounded-xl border border-border/60 bg-background/40";
const adminDetailTableHeaderRow = "border-border/60 hover:bg-transparent";
const adminDetailTableHead =
  "h-11 bg-muted/15 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/90 first:pl-4 last:pr-4";
const adminDetailTableRow = "border-border/50 transition-colors duration-200 hover:bg-muted/20";
const adminDetailTableCell = "py-3.5 first:pl-4 last:pr-4";

export default function AdminTeamWorkspacePage() {
  const params = useParams<{ id: string }>();
  const teamId = Number(params.id);

  const teamQuery = useQuery({
    queryKey: ["admin", "team", teamId],
    queryFn: () => adminService.getTeam(teamId) as Promise<AdminTeamDetail>,
    enabled: Number.isFinite(teamId),
  });

  const team = teamQuery.data;

  if (teamQuery.isLoading) {
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

  if (!team) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team not found</CardTitle>
          <CardDescription>The requested admin workspace could not be loaded.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={team.name}
        description="Team workspace with roster details, captain ownership, and tournament context."
        meta={<Badge variant="secondary">Roster control</Badge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/teams">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Teams
              </Link>
            </Button>
            {team.tournament ? (
              <Button asChild variant="outline">
                <Link href={`/admin/tournaments/${team.tournament.id}`}>
                  <Trophy className="mr-2 h-4 w-4" />
                  Open Tournament
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Average SR</CardDescription>
            <CardTitle>{team.avg_sr.toFixed(0)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Balanced roster average</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total SR</CardDescription>
            <CardTitle>{team.total_sr}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Combined current roster SR</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Roster Size</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              {team.players?.length ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Players assigned to this team</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Captain</CardDescription>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-muted-foreground" />
              {team.captain?.name ?? `User #${team.captain?.id}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Tournament owner reference for this roster
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Roster</CardTitle>
            <CardDescription>Current players assigned to this team.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={adminDetailTableShell}>
              <Table>
                <TableHeader>
                  <TableRow className={adminDetailTableHeaderRow}>
                    <TableHead className={adminDetailTableHead}>Player</TableHead>
                    <TableHead className={adminDetailTableHead}>Role</TableHead>
                    <TableHead className={adminDetailTableHead}>Rank</TableHead>
                    <TableHead className={adminDetailTableHead}>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.players?.map((player) => (
                    <TableRow key={player.id} className={adminDetailTableRow}>
                      <TableCell className={adminDetailTableCell}>
                        <div className="font-medium">{player.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {player.user?.name ? `Linked user: ${player.user.name}` : `User ID: ${player.user_id}`}
                        </div>
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        <Badge variant="outline" className="capitalize">
                          {player.role}
                        </Badge>
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        {player.rank} / {player.division}
                      </TableCell>
                      <TableCell className={adminDetailTableCell}>
                        <div className="flex flex-wrap gap-2">
                          {player.primary ? <StatusIcon icon={Star} label="Primary" variant="success" /> : null}
                          {player.secondary ? <StatusIcon icon={StarHalf} label="Secondary" variant="muted" /> : null}
                          {player.is_newcomer ? <StatusIcon icon={Sparkles} label="Newcomer" variant="warning" /> : null}
                          {player.is_substitution ? <StatusIcon icon={ArrowLeftRight} label="Substitute" variant="info" /> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tournament Context</CardTitle>
              <CardDescription>Where this team currently lives in operations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Trophy className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium">{team.tournament?.name ?? "Tournament unavailable"}</div>
                  <div className="text-muted-foreground">
                    {team.tournament
                      ? `${new Date(team.tournament.start_date).toLocaleDateString()} - ${new Date(team.tournament.end_date).toLocaleDateString()}`
                      : "No linked tournament metadata loaded."}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <UserCircle2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium">Captain Assignment</div>
                  <div className="text-muted-foreground">
                    {team.captain?.name ?? `User #${team.captain?.id}`} controls roster ownership.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Links</CardTitle>
              <CardDescription>Jump back into the larger operations flows.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
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
      </div>
    </div>
  );
}
