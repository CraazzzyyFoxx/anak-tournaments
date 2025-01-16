import React from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Star } from "lucide-react";
import { TypographyH4 } from "@/components/ui/typography";
import HeroPlaytimeChart from "@/components/HeroPlaytimeChart";
import { Tournament } from "@/types/tournament.types";
import heroService from "@/services/hero.service";

const TournamentHeroPlaytimePage = async ({ tournament }: { tournament: Tournament }) => {
  const stats = await heroService.getHeroPlaytime(1, 10, "all", tournament.id);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-row gap-2">
          <Star />
          <TypographyH4>Most played heroes</TypographyH4>
        </div>
      </CardHeader>
      <div className="flex-1 px-2 pb-4 max-w-[840px]">
        <HeroPlaytimeChart heroes={stats.results} />
      </div>
    </Card>
  );
};

export default TournamentHeroPlaytimePage;
