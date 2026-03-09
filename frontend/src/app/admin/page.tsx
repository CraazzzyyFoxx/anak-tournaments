"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Trophy,
  Users,
  UserCircle,
  Swords,
  BarChart3,
  Shield,
  Map,
  Gamepad2,
  Award,
} from "lucide-react";
import { customFetch } from "@/lib/custom_fetch";

interface DashboardStats {
  tournaments: number;
  teams: number;
  players: number;
  encounters: number;
  users: number;
  heroes: number;
  gamemodes: number;
  maps: number;
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin", "dashboard-stats"],
    queryFn: async () => {
      // Fetch all counts in parallel
      const [tournaments, teams, encounters, users] = await Promise.all([
        customFetch("/tournaments").then((r) => r.json()),
        customFetch("/teams").then((r) => r.json()),
        customFetch("/encounters").then((r) => r.json()),
        customFetch("/users").then((r) => r.json()),
      ]);

      // Count players from teams
      const playerCount = teams.reduce(
        (sum: number, team: any) => sum + (team.players?.length || 0),
        0
      );

      return {
        tournaments: tournaments.length || 0,
        teams: teams.length || 0,
        players: playerCount,
        encounters: encounters.length || 0,
        users: users.length || 0,
      } as DashboardStats;
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Manage tournaments, teams, players, and game content.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tournaments</CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.tournaments || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Total tournaments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Teams</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.teams || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Total teams</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Players</CardTitle>
            <UserCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.players || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Total players</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Encounters</CardTitle>
            <Swords className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.encounters || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Total encounters</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Users</CardTitle>
            <UserCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.users || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Total users</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tournament Operations</CardTitle>
            <CardDescription>Quick actions for managing tournaments</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/tournaments">
                <Trophy className="mr-2 h-4 w-4" />
                Manage Tournaments
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/teams">
                <Users className="mr-2 h-4 w-4" />
                Manage Teams
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/encounters">
                <Swords className="mr-2 h-4 w-4" />
                Manage Encounters
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/standings">
                <BarChart3 className="mr-2 h-4 w-4" />
                View Standings
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Game Content</CardTitle>
            <CardDescription>Manage heroes, maps, and gamemodes</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/heroes">
                <Shield className="mr-2 h-4 w-4" />
                Manage Heroes
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/gamemodes">
                <Gamepad2 className="mr-2 h-4 w-4" />
                Manage Gamemodes
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/maps">
                <Map className="mr-2 h-4 w-4" />
                Manage Maps
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href="/admin/achievements">
                <Award className="mr-2 h-4 w-4" />
                Manage Achievements
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity - Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Recent changes and updates</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No recent activity</p>
        </CardContent>
      </Card>
    </div>
  );
}
