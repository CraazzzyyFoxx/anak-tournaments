"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import userService from "@/services/user.service";
import SearchableImageSelect, {
  type SearchableImageOption
} from "@/app/(site)/users/compare/components/SearchableImageSelect";
import UserHeroes from "@/app/(site)/users/components/UserHeroes";

interface UserHeroesContainerProps {
  userId: number;
}

const UserHeroesContainer = ({ userId }: UserHeroesContainerProps) => {
  const [tournamentId, setTournamentId] = useState<number | undefined>(undefined);

  const tournamentsQuery = useQuery({
    queryKey: ["user-tournaments", userId],
    queryFn: () => userService.getUserTournaments(userId),
    staleTime: 5 * 60 * 1000
  });

  const heroesQuery = useQuery({
    queryKey: ["user-heroes", userId, tournamentId],
    queryFn: () => userService.getUserHeroes(userId, undefined, tournamentId),
    staleTime: 5 * 60 * 1000
  });

  const tournamentOptions = useMemo<SearchableImageOption[]>(() => {
    return (tournamentsQuery.data ?? []).map((t) => ({
      value: String(t.id),
      label: t.name
    }));
  }, [tournamentsQuery.data]);

  const heroes = heroesQuery.data?.results ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-xs font-semibold text-muted-foreground">Tournament</div>
        <div className="w-64">
          <SearchableImageSelect
            value={tournamentId ? String(tournamentId) : undefined}
            onValueChange={(val) => setTournamentId(val ? Number(val) : undefined)}
            options={tournamentOptions}
            placeholder="All tournaments"
            searchPlaceholder="Search tournament..."
            isLoading={tournamentsQuery.isLoading}
            disabled={tournamentsQuery.isLoading || tournamentsQuery.isError}
          />
        </div>
      </div>
      <UserHeroes heroes={heroes} />
    </div>
  );
};

export default UserHeroesContainer;
