"use client";

import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import tournamentService from "@/services/tournament.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import TournamentCard from "@/app/(site)/tournaments/components/TournamentCard";
import StatisticsCard from "@/components/StatisticsCard";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCardSkeleton } from "@/app/home-skeletons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Trophy, Zap, Shield, Users } from "lucide-react";
import {
  isTournamentStatusActive,
  TOURNAMENT_STATUS_OPTIONS,
} from "@/lib/tournament-status";
import type { TournamentStatus } from "@/types/tournament.types";

const TournamentCardSkeleton = () => (
  <div className="flex flex-col rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
    <div className="flex items-center justify-between mb-3">
      <Skeleton className="h-4 w-14 rounded-full" />
      <Skeleton className="h-3 w-6" />
    </div>
    <Skeleton className="h-4 w-3/4 mb-1" />
    <Skeleton className="h-4 w-1/2 mb-4" />
    <div className="space-y-1.5 mb-4">
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
    <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
      <Skeleton className="h-3 w-14" />
      <Skeleton className="h-3 w-12" />
    </div>
  </div>
);

const TournamentsPageSkeleton = () => (
  <div className="space-y-8">
    <div className="flex flex-col gap-1">
      <Skeleton className="h-9 w-44" />
      <Skeleton className="h-4 w-96" />
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
    </div>

    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
      <div className="flex gap-1">
        <Skeleton className="h-8 w-10 rounded-md" />
        <Skeleton className="h-8 w-18 rounded-md" />
        <Skeleton className="h-8 w-18 rounded-md" />
      </div>
      <div className="flex gap-1">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>
      <Skeleton className="h-9 w-44 rounded-md" />
    </div>

    <div className="grid xs:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
      {Array.from({ length: 8 }).map((_, i) => <TournamentCardSkeleton key={i} />)}
    </div>
  </div>
);

export const dynamic = 'force-dynamic';

type StatusFilter = 'all' | TournamentStatus;
type TypeFilter = 'all' | 'standard' | 'league';
type SortBy = 'latest' | 'oldest' | 'participants';

const TournamentsPage = () => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('latest');
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const { data: tournaments, isLoading } = useQuery({
    queryKey: ["tournaments", workspaceId],
    queryFn: () => tournamentService.getAll(null, workspaceId),
  });

  // Filter and sort tournaments
  const filteredTournaments = useMemo(() => {
    if (!tournaments?.results) return [];

    let filtered = tournaments.results;

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter((t) => t.status === statusFilter);
    }

    // Filter by type
    if (typeFilter === 'standard') {
      filtered = filtered.filter(t => !t.is_league);
    } else if (typeFilter === 'league') {
      filtered = filtered.filter(t => t.is_league);
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'latest':
          return new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
        case 'oldest':
          return new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
        case 'participants':
          return (b.participants_count || 0) - (a.participants_count || 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [tournaments, statusFilter, typeFilter, sortBy]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (!tournaments?.results) {
      return {
        total: 0,
        active: 0,
        leagues: 0,
        totalParticipants: 0,
      };
    }

    return {
      total: tournaments.total,
      active: tournaments.results.filter((t) => isTournamentStatusActive(t.status)).length,
      leagues: tournaments.results.filter(t => t.is_league).length,
      totalParticipants: tournaments.results.reduce(
        (sum, t) => sum + (t.participants_count || 0), 0
      ),
    };
  }, [tournaments]);

  if (isLoading) {
    return <TournamentsPageSkeleton />;
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold leading-none tracking-tight">
          Tournaments
        </h1>
        <p className="text-sm text-muted-foreground">
          Browse all tournaments, filter by status, and view detailed statistics.
        </p>
      </div>

      {/* Statistics Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatisticsCard name="Total Tournaments" value={stats.total} icon={<Trophy className="h-4 w-4" />} iconClassName="bg-indigo-500/10 text-indigo-400" />
        <StatisticsCard name="Active" value={stats.active} icon={<Zap className="h-4 w-4" />} iconClassName="bg-emerald-500/10 text-emerald-400" />
        <StatisticsCard name="Leagues" value={stats.leagues} icon={<Shield className="h-4 w-4" />} iconClassName="bg-purple-500/10 text-purple-400" />
        <StatisticsCard name="Total Participants" value={stats.totalParticipants} icon={<Users className="h-4 w-4" />} iconClassName="bg-blue-500/10 text-blue-400" />
      </div>

      {/* Filter Controls */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
        {/* Status Filter */}
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {TOURNAMENT_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Type Filters */}
        <ToggleGroup
          type="single"
          value={typeFilter}
          onValueChange={(value) => value && setTypeFilter(value as TypeFilter)}
          variant="outline"
        >
          <ToggleGroupItem value="all">All Types</ToggleGroupItem>
          <ToggleGroupItem value="standard">Standard</ToggleGroupItem>
          <ToggleGroupItem value="league">League</ToggleGroupItem>
        </ToggleGroup>

        {/* Sort Dropdown */}
        <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Latest First</SelectItem>
            <SelectItem value="oldest">Oldest First</SelectItem>
            <SelectItem value="participants">Most Participants</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tournament Grid */}
      {filteredTournaments.length === 0 ? (
        <div className="col-span-full flex flex-col items-center justify-center py-16">
          <Trophy className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">No tournaments found</h2>
          <p className="text-muted-foreground">
            Try adjusting your filters or check back soon for upcoming tournaments!
          </p>
        </div>
      ) : (
        <div className="grid xs:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredTournaments.map((tournament) => (
            <TournamentCard key={tournament.id} tournament={tournament} />
          ))}
        </div>
      )}
    </div>
  );
};

export default TournamentsPage;
