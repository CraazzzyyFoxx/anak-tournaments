import React, { ReactNode } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Match, MatchWithStats } from "@/types/encounter.types";
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import encounterService from "@/services/encounter.service";
import { PlayerWithStats, TeamWithStats } from "@/types/team.types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { sortTeamPlayers } from "@/utils/player";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import PlayerName from "@/components/PlayerName";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const EncounterMatchHeader = async ({ data }: { data: MatchWithStats }) => {
  return (
    <div className="p-4">
      <div className="flex flex-row gap-8 items-center">
        <div className="flex flex-row gap-4 items-center">
          <Image
            src={data.map?.gamemode.image_path || ""}
            alt={data.map?.gamemode.name || "Gamemode"}
            height={40}
            width={40}
          />
          <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">{data.map?.name}</h4>
        </div>
        <div className="flex flex-row gap-4">
          <div className="flex flex-col text-right">
            <p className="leading-7 text-[#16e5b4]">{data.home_team.name}</p>
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight text-[#16e5b4]">
              {data.score.home}
            </h4>
          </div>
          <div className="flex items-end">
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">:</h4>
          </div>
          <div className="flex flex-col text-left">
            <p className="leading-7  text-[#ff4655]">{data.away_team.name}</p>
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight text-[#ff4655]">
              {data.score.away}
            </h4>
          </div>
        </div>
        <div className="flex flex-row gap-4">
          <div className="flex flex-col text-right">
            <p className="leading-7">Playtime</p>
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">
              {Math.floor(data.time / 60)}m {(data.time % 60).toFixed(0)}s
            </h4>
          </div>
        </div>
        <div className="flex flex-row gap-4">
          <div className="flex flex-col text-right">
            <p className="leading-7">Log name</p>
            <h4 className="scroll-m-20 text-xl font-semibold tracking-tight">{data.log_name}</h4>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PerformanceBadge = ({ performance }: { performance: number | undefined }) => {
  let bgColor = "bg-[#2c3f52]";
  let color = "text-[#ffffff]";
  if (performance == 1) {
    bgColor = "bg-[#cbb765]";
    color = "text-[#121009]";
  }
  if (performance == 2) {
    bgColor = "bg-[#99b0cc]";
    color = "text-[#121009]";
  }
  if (performance == 3) {
    bgColor = "bg-[#a86243]";
  }

  return (
    <div
      className={`inline-flex items-center rounded-xl border px-2.5 py-0.5 text-xs font-semibold ${bgColor} ${color}`}
    >
      <span>{performance}th</span>
    </div>
  );
};

interface EncounterMatchTeamProps {
  team: TeamWithStats;
  isHome: boolean;
  maxHeroes: number;
  matchRound: number;
}

const EncounterMatchTeam = async ({
  team,
  isHome,
  maxHeroes,
  matchRound
}: EncounterMatchTeamProps) => {
  // @ts-ignore
  const sortedPlayers: PlayerWithStats[] = sortTeamPlayers(team.players);
  const backgroundColor = isHome ? "[#104e48]" : "[#4c2332]";

  const validatedPlayers = [];

  for (let playerI = 0; playerI < sortedPlayers.length; playerI++) {
    const player = sortedPlayers[playerI];
    if (player.heroes[matchRound]?.length > 0) {
      validatedPlayers.push(player);
    }
  }

  return (
    <Table>
      <TableHeader className="border-none">
        <TableRow className={`bg-${backgroundColor} hover:bg-${backgroundColor}`}>
          <TableHead className="min-w-[240px]">Team {team.name}</TableHead>
          <TableHead className="text-center">Division</TableHead>
          <TableHead className="text-center">Heroes</TableHead>
          <TableHead className="text-center">PRS</TableHead>
          <TableHead className="text-center">FB</TableHead>
          <TableHead className="text-center">E</TableHead>
          <TableHead className="text-center">D</TableHead>
          <TableHead className="text-center">A</TableHead>
          <TableHead className="text-center">K/D</TableHead>
          <TableHead className="text-center">KA/D</TableHead>
          <TableHead className="text-center">SK</TableHead>
          <TableHead className="text-center">OK</TableHead>
          <TableHead className="text-center">Hero Damage</TableHead>
          <TableHead className="text-center">Dmg/FB</TableHead>
          <TableHead className="text-center">Healing Dealt</TableHead>
          <TableHead className="text-center">Damage Blocked</TableHead>
          <TableHead className="text-center">Dlt Damage</TableHead>
          <TableHead className="text-center">Ult Used/Earned</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {validatedPlayers.map((player) => {
          const color = isHome ? "from-[#104e48]" : "from-[#4c2332]";
          const missingHeroes = maxHeroes - player.heroes[matchRound].length;

          if (missingHeroes > 0) {
            for (let i = 0; i < missingHeroes; i++) {
              // @ts-ignore
              player.heroes[matchRound].push({ id: i, name: " ", image_path: "" });
            }
          }

          return (
            <TableRow key={player.id} className="hover:bg-background">
              <TableCell
                className={`flex flex-row items-center gap-2 bg-gradient-to-r ${color} via-background to-background`}
              >
                <PlayerRoleIcon role={player.role} />
                <PlayerName player={player} includeSpecialization={true} />
              </TableCell>
              <TableCell>
                <div className="flex justify-center">
                  <Image
                    src={`/divisions/${player.division}.png`}
                    alt="Division"
                    width={32}
                    height={32}
                  />
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-row gap-1.5">
                  {player.heroes[matchRound].map((hero) => {
                    return (
                      // Возможно надо будет вернуть AvatarImage
                      <Avatar key={`hero-${hero.id}`}>
                        {hero.image_path ? (
                          <Image
                            src={hero.image_path}
                            alt={hero.name}
                            layout="fill"
                            objectFit="cover"
                          />
                        ) : (
                          <AvatarFallback delayMs={200} className="bg-background">
                            {hero.name.slice(0, 3)}
                          </AvatarFallback>
                        )}
                      </Avatar>
                    );
                  })}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-center">
                  <PerformanceBadge performance={player.stats[matchRound].performance} />
                </div>
              </TableCell>
              <TableCell className="text-center">{player.stats[matchRound].final_blows}</TableCell>
              <TableCell className="text-center">{player.stats[matchRound].eliminations}</TableCell>
              <TableCell className="text-center">{player.stats[matchRound].deaths}</TableCell>
              <TableCell className="text-center">{player.stats[matchRound].assists}</TableCell>
              <TableCell className="text-center">{player.stats[matchRound].kd}</TableCell>
              <TableCell className="text-center">{player.stats[matchRound].kda}</TableCell>
              <TableCell className="text-center">{player.stats[matchRound].solo_kills}</TableCell>
              <TableCell className="text-center">
                {player.stats[matchRound].objective_kills}
              </TableCell>
              <TableCell className="text-center">
                {player.stats[matchRound].hero_damage_dealt.toFixed(0)}
              </TableCell>
              <TableCell className="text-center">
                {player.stats[matchRound].damage_fb.toFixed(0)}
              </TableCell>
              <TableCell className="text-center">
                {player.stats[matchRound].healing_dealt.toFixed(0)}
              </TableCell>
              <TableCell className="text-center">
                {player.stats[matchRound].damage_blocked.toFixed(0)}
              </TableCell>
              <TableCell className="text-center">
                {player.stats[matchRound].damage_delta.toFixed(0)}
              </TableCell>
              <TableCell className="text-center">
                {player.stats[matchRound].ultimates_used}/
                {player.stats[matchRound].ultimates_earned}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

const EncounterMatch = async ({ match }: { match: Match }) => {
  const mapImagePath: string = match.map ? match.map?.image_path : "";
  const data = await encounterService.getMatch(match.id);

  const maxHeroesHome: Record<number, number> = {};
  const maxHeroesAway: Record<number, number> = {};
  const maxHeroes: Record<number, number> = {};
  let maxRoundI = 0;
  for (let roundI = 0; roundI < data.rounds + 1; roundI++) {
    maxRoundI = Math.max(maxRoundI, roundI);
    maxHeroesHome[roundI] = data.home_team.players.reduce(
      (max, player) => Math.max(max, player.heroes[roundI] ? player.heroes[roundI].length : 0),
      0
    );
    maxHeroesAway[roundI] = data.away_team.players.reduce(
      (max, player) => Math.max(max, player.heroes[roundI] ? player.heroes[roundI].length : 0),
      0
    );
    maxHeroes[roundI] = Math.max(maxHeroesHome[roundI], maxHeroesAway[roundI]);
  }

  const tabsTriggers: ReactNode[] = [];
  const tabsContent: ReactNode[] = [];
  Object.keys(data.home_team.players[0].stats).forEach((key) => {
    if (key != "0") {
      tabsTriggers.push(<TabsTrigger value={key}>Round {key}</TabsTrigger>);
    }
    tabsContent.push(
      <TabsContent value={key}>
        <EncounterMatchTeam
          team={data.home_team}
          isHome={true}
          matchRound={parseInt(key)}
          maxHeroes={maxHeroes[parseInt(key)]}
        />
        <EncounterMatchTeam
          team={data.away_team}
          isHome={false}
          matchRound={parseInt(key)}
          maxHeroes={maxHeroes[parseInt(key)]}
        />
      </TabsContent>
    );
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Card className="overflow-hidden relative h-[115px] max-w-[230px]">
          <Image src={mapImagePath} alt="Map" fill={true} />
          <h4 className="absolute bottom-0 left-0 m-2 text-xl font-semibold tracking-tight text-white p-1">
            {match.map?.name}
          </h4>
        </Card>
      </DialogTrigger>
      <DialogContent className="xs:min-w-full xl:min-w-fit min-h-fit p-0">
        <VisuallyHidden>
          <DialogHeader />
        </VisuallyHidden>
        <div className="flex flex-col">
          <EncounterMatchHeader data={data} />
          <Tabs defaultValue="0">
            <TabsList className="ml-8">
              <TabsTrigger value="0">All Match</TabsTrigger>
              {...tabsTriggers}
            </TabsList>
            {...tabsContent}
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EncounterMatch;
