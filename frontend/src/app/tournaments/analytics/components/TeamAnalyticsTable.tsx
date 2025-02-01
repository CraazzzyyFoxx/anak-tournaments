import React from "react";
import { PlayerAnalytics, TeamAnalytics } from "@/types/team.types";
import { sortTeamPlayers } from "@/utils/player";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import PlayerName from "@/components/PlayerName";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { TypographyH4 } from "@/components/ui/typography";


export const TournamentTeamTable = ({ players }: { players: PlayerAnalytics[] }) => {
  // @ts-ignore
  const sortedPlayers: PlayerAnalytics[] = sortTeamPlayers(players);

  return (
    <ScrollArea>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Battle tag</TableHead>
            <TableHead className="text-center">Division</TableHead>
            <TableHead className="text-center">Move 2</TableHead>
            <TableHead className="text-center">Move 1</TableHead>
            <TableHead className="text-center">Points</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedPlayers.map((player) => {
            return (
              <TableRow key={player.id}>
                <TableCell className="font-medium">
                  <PlayerRoleIcon role={player.role} />
                </TableCell>
                <TableCell>
                  <PlayerName player={player} includeSpecialization={false} excludeBadge={true}/>
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
                <TableCell className="text-center">{player.move_2}</TableCell>
                <TableCell className="text-center">{player.move_1}</TableCell>
                <TableCell className="text-center">{player.points}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};


const TeamAnalyticsTable = ({ team }: { team: TeamAnalytics }) => {
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
          <TypographyH4 className={color}>Group {team.group?.name}</TypographyH4>
        </div>
      </div>
      <CardContent className="p-0">
        <TournamentTeamTable players={team.players} />
      </CardContent>
    </Card>
  );
};

export default TeamAnalyticsTable;