import React from "react";
import { sortTeamPlayers } from "@/utils/player";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { CircleMinus, CirclePlus, CornerDownRight } from "lucide-react";
import Image from "next/image";
import PlayerName from "@/components/PlayerName";
import { Player, Team } from "@/types/team.types";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { TypographyH4 } from "@/components/ui/typography";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const TournamentTeamCardSkeleton = () => {
  return <Skeleton className="w-[450px] h-[425px] rounded-xl"></Skeleton>;
};

export const TournamentTeamTable = ({ players }: { players: Player[] }) => {
  const sortedPlayers = sortTeamPlayers(players);

  return (
    <ScrollArea>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Battle tag</TableHead>
            <TableHead className="text-center">Division</TableHead>
            <TableHead className="text-center">New</TableHead>
            <TableHead className="text-center">New Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedPlayers.map((player) => {
            return (
              <TableRow key={player.id}>
                <TableCell className="font-medium">
                  {player.is_substitution ? (
                    <div>
                      <CornerDownRight className="ml-2.5" />
                    </div>
                  ) : (
                    <PlayerRoleIcon role={player.role} />
                  )}
                </TableCell>
                <TableCell>
                  <PlayerName player={player} includeSpecialization={true} />
                </TableCell>
                <TableCell>
                  <div className="flex justify-center">
                    <Image
                      src={`/divisions/${player.division}.png`}
                      alt="Division"
                      width={36}
                      height={36}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center">
                    {player.is_newcomer ? (
                      <CirclePlus className="text-red-500" />
                    ) : (
                      <CircleMinus className="text-green-500" />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center">
                    {player.is_newcomer_role ? (
                      <CirclePlus className="text-red-500" />
                    ) : (
                      <CircleMinus className="text-green-500" />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};

export const TournamentTeamCard = ({ team }: { team: Team }) => {
  let color = "text-group-a";

  if (team.group?.name == "B") color = "text-group-b";
  if (team.group?.name == "C") color = "text-group-c";
  if (team.group?.name == "D") color = "text-group-d";

  return (
    <Card id={team.id.toString()} key={team.id}>
      <div className="flex flex-row justify-between p-6">
        <div>
          <TypographyH4>Team {team.name}</TypographyH4>
          <div className="flex gap-2">
            <small className="text-sm font-medium leading-none">Placement: {team.placement}</small>
          </div>
        </div>
        <div className="text-right">
          <TypographyH4>Avg. sr: {team.avg_sr.toFixed(0)}</TypographyH4>
          <TypographyH4 className={color}>Group {team.group?.name}</TypographyH4>
        </div>
      </div>
      <CardContent className="p-0">
        <TournamentTeamTable players={team.players} />
      </CardContent>
    </Card>
  );
};
