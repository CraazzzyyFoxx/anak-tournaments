"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import userService from "@/services/user.service";
import { TournamentCombobox } from "@/components/tournaments/TournamentCombobox";
import CharacterStatsTable from "@/components/profile/CharacterStatsTable";
import ProfileWidget from "@/components/profile/ProfileWidget";
import { Skeleton } from "@/components/ui/skeleton";
import { userQueryKeys } from "@/lib/users/query-keys";
import type { StatsScope } from "@/lib/site/stats-scope";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

interface UserHeroesContainerProps {
  userId: number;
  /** The game's profile tournaments: the tournament filter's options. */
  tournaments: { id: number; name: string }[];
  scope: StatsScope;
  discipline: string;
  /** The viewed workspace axis the game's metadata is read on. */
  axis: WorkspaceAxis;
}

const UserHeroesContainer = ({ userId, tournaments, scope, discipline, axis }: UserHeroesContainerProps) => {
  const [tournamentId, setTournamentId] = useState<number | undefined>(undefined);

  const charactersQuery = useQuery({
    queryKey: userQueryKeys.characters(userId, scope, discipline, tournamentId),
    queryFn: ({ signal }) => userService.getUserCharacters(userId, discipline, { tournamentId, scope, signal }),
    staleTime: 5 * 60 * 1000
  });

  // Maps (with per-character stats) power the "Maps for [character]" panel in HeroesView.
  const mapsQuery = useQuery({
    queryKey: userQueryKeys.characterMaps(userId, scope, discipline, tournamentId),
    queryFn: () => userService.getUserMaps(userId, discipline, { perPage: -1, minCount: 1, tournamentId, scope }),
    staleTime: 5 * 60 * 1000
  });

  if (charactersQuery.isLoading) {
    return (
      <div className="aqt-player flex flex-col gap-3.5">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-60 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
        <Skeleton className="h-150 w-full rounded-xl" />
      </div>
    );
  }

  const characters = charactersQuery.data?.results ?? [];

  const filterSlot = (
    <div className="w-60">
      <TournamentCombobox tournaments={tournaments} value={tournamentId} onValueChange={setTournamentId} />
    </div>
  );

  return (
    <ProfileWidget
      axis={axis}
      discipline={discipline}
      slot="characterStats"
      props={{ characters, maps: mapsQuery.data?.results ?? [], filterSlot }}
      fallback={<CharacterStatsTable axis={axis} discipline={discipline} characters={characters} action={filterSlot} />}
    />
  );
};

export default UserHeroesContainer;
