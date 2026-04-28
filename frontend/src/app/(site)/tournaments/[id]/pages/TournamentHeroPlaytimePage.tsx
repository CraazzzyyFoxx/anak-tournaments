"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Star } from "lucide-react";
import { TypographyH4 } from "@/components/ui/typography";
import HeroPlaytimeChart from "@/components/HeroPlaytimeChart";
import { Tournament } from "@/types/tournament.types";
import heroService from "@/services/hero.service";
import { tournamentQueryKeys } from "@/lib/tournament-query-keys";

const TournamentHeroPlaytimePage = ({ tournament }: { tournament: Tournament }) => {
  const statsQuery = useQuery({
    queryKey: tournamentQueryKeys.heroPlaytime(tournament.id),
    queryFn: () =>
      heroService.getHeroPlaytime(1, 20, "all", tournament.id, {
        workspaceId: tournament.workspace_id,
      }),
  });

  if (statsQuery.isLoading) {
    return <Skeleton className="h-[420px] w-full rounded-xl" />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-row gap-2">
          <Star />
          <TypographyH4>Most played heroes</TypographyH4>
        </div>
      </CardHeader>
      <div className="px-2 pb-4">
        <HeroPlaytimeChart heroes={statsQuery.data?.results ?? []} />
      </div>
    </Card>
  );
};

export default TournamentHeroPlaytimePage;
