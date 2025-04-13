"use client";

import React, { useMemo } from "react";
import { HeroBestStat, HeroWithUserStats } from "@/types/hero.types";
import CustomSelect from "@/components/CustomSelect";
import { Card, CardContent } from "@/components/ui/card";
import Image from "next/image";
import { LogStatsName } from "@/types/stats.types";
import StatisticsCard from "@/components/StatisticsCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getHumanizedStats } from "@/utils/stats";
import Link from "next/link";
import { Crown, TrendingDown, TrendingUp } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const prepareValue = (name: string, value: number) => {
  if (name.includes("accuracy")) {
    if (value > 1) return "-";
    return `${(value * 100).toFixed(2)}%`;
  }

  if (value < 1000) {
    return value;
  }
  return value.toFixed(0);
};

const BestResult = ({
  name,
  stat,
  best,
  all
}: {
  name: string;
  stat: HeroBestStat;
  best: HeroBestStat;
  all: boolean;
}) => {
  return (
    <Tooltip>
      <TooltipTrigger>
        <div>
          <Link className="flex flex-row gap-2" href={`/encounters/${stat.encounter_id}`}>
            <span>{prepareValue(name, stat.value)}</span>
            {!all && stat.value === best.value ? <Crown className="text-yellow-500" /> : <></>}
          </Link>
        </div>
      </TooltipTrigger>
      <TooltipContent className="flex flex-col px-0 py-0 bg-background text-center">
        <Link href={`/encounters/${stat.encounter_id}`}>
          <Image src={stat.map_image_path} alt={stat.map_name} height={125} width={250} />
          <div className="flex flex-col gap-1 my-2">
            <div className="text-lg font-semibold tracking-tight text-white">
              {stat.tournament_name}
            </div>
            {all ? (
              <div className="text-lg font-semibold tracking-tight text-white">
                <div>
                  <span>Player: </span>
                  <span className="text-muted-foreground">{stat.player_name.split("#")[0]}</span>
                </div>
              </div>
            ) : null}
          </div>
        </Link>
      </TooltipContent>
    </Tooltip>
  );
};

const UserHeroes = ({ heroes }: { heroes: HeroWithUserStats[] }) => {
  const sortedHeroes = useMemo(
    () =>
      heroes.sort(
        (a, b) =>
          b.stats.find((stat) => stat.name === LogStatsName.HeroTimePlayed)!.overall -
          a.stats.find((stat) => stat.name === LogStatsName.HeroTimePlayed)!.overall
      ),
    [heroes]
  );

  const heroesItems = sortedHeroes.map((hero) => {
    return {
      value: hero.hero.id,
      label: hero.hero.name,
      item: (
        <div className="flex flex-row gap-2 items-center">
          <Image src={hero.hero.image_path} alt={hero.hero.name} height={32} width={32} />
          <span className="ml-2">{hero.hero.name}</span>
        </div>
      )
    };
  });

  const [selectedHeroId, setSelectedHeroId] = React.useState<number>(heroesItems[0].value);
  const [selectedHero, setSelectedHero] = React.useState<HeroWithUserStats>(heroes[0]);

  const setSelectedHeroData = (id: number) => {
    setSelectedHeroId(id);
    setSelectedHero(heroes.find((hero) => hero.hero.id === id)!);
  };

  const playTime = useMemo(
    () => selectedHero.stats.find((stat) => stat.name === LogStatsName.HeroTimePlayed)!.overall,
    [selectedHero]
  );

  const filteredStats = useMemo(() => {
    const first = selectedHero.stats.filter((stat) => stat.name !== LogStatsName.HeroTimePlayed);
    return first.filter((stat) => stat.avg_10_all > 0);
  }, [selectedHero]);

  const compareAvg = (a: number, b: number, reverted: boolean) => {
    if (!reverted) {
      return a > b ? (
        <TrendingUp className="text-green-500" />
      ) : (
        <TrendingDown className="text-red-500" />
      );
    } else {
      return a > b ? (
        <TrendingDown className="text-red-500" />
      ) : (
        <TrendingUp className="text-green-500" />
      );
    }
  };

  return (
    <div className="w-full grid xl:grid-cols-11 xs:grid-cols-3 gap-8">
      <div className="col-span-3">
        <Card>
          <CardContent className="flex flex-col gap-6 pt-6">
            <CustomSelect
              className="w-full"
              items={heroesItems}
              value={selectedHeroId}
              onSelect={(value) => setSelectedHeroData(value)}
            />
            <Card
              className={`relative w-full border-4 aspect-square  `}
              style={{ borderColor: selectedHero.hero.color }}
            >
              <Image
                className="object-cover rounded-xl"
                src={selectedHero.hero.image_path}
                alt={selectedHero.hero.name}
                fill={true}
              />
            </Card>
            <StatisticsCard
              name="Playtime"
              value={`${Math.floor(playTime / 3600)}h ${Math.floor((playTime % 3600) / 60)}m ${(playTime % 60).toFixed(0)}s`}
            />
          </CardContent>
        </Card>
      </div>
      <Card className="md:col-span-8 xs:col-span-3">
        <ScrollArea>
          <CardContent className="p-0">
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center text-lg">Name</TableHead>
                    <TableHead className="text-center text-lg">Overall</TableHead>
                    <TableHead className="text-center text-lg">Best Result</TableHead>
                    <TableHead className="text-center text-lg">Avg.</TableHead>
                    <TableHead className="text-center text-lg">Best All</TableHead>
                    <TableHead className="text-center text-lg">All avg.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStats.map((stat, index) => {
                    return (
                      <TableRow key={stat.name} className={index % 2 === 1 ? "" : ""}>
                        <TableCell className="text-lg">{getHumanizedStats(stat.name)}</TableCell>
                        <TableCell className="text-center text-base">
                          {prepareValue(stat.name, stat.overall)}
                        </TableCell>
                        <TableCell className="text-center text-base">
                          <div className="flex justify-center">
                            <BestResult
                              name={stat.name}
                              stat={stat.best}
                              best={stat.best_all}
                              all={false}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="flex justify-center text-base">
                          <div className="flex flex-row gap-2 items-center">
                            <span>{prepareValue(stat.name, stat.avg_10)}</span>
                            {compareAvg(
                              stat.avg_10,
                              stat.avg_10_all,
                              [
                                LogStatsName.Deaths,
                                LogStatsName.DamageTaken,
                                LogStatsName.EnvironmentalDeaths
                              ].includes(stat.name)
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-base">
                          <BestResult
                            name={stat.name}
                            stat={stat.best_all}
                            best={stat.best_all}
                            all={true}
                          />
                        </TableCell>
                        <TableCell className="text-center text-base">
                          {prepareValue(stat.name, stat.avg_10_all)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TooltipProvider>
          </CardContent>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </Card>
    </div>
  );
};

export default UserHeroes;
