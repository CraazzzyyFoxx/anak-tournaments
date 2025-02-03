import React, { useMemo } from "react";
import { PlayerAnalytics, TeamAnalytics } from "@/types/analytics.types";
import { sortTeamPlayers } from "@/utils/player";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import PlayerName from "@/components/PlayerName";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { TypographyH4 } from "@/components/ui/typography";
import { TournamentTeamCardSkeleton } from "@/components/TournamentTeamCard";

export const TournamentTeamTable = ({ players }: { players: PlayerAnalytics[] }) => {
  // @ts-ignore
  const sortedPlayers: PlayerAnalytics[] = useMemo(
    () => {
      return sortTeamPlayers(players)
    }, [players]
  );

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
            <TableHead className="text-center">Shift</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedPlayers.map((player) => {
            let color_shift = "text-center";
            let color = "";

            if (player.points <= -1) color_shift = "text-center bg-green-400 text-black";
            if (player.points >= 1) color_shift = "text-center bg-red-400 text-black";

            if (player.is_newcomer_role) color = "bg-blue-400 hover:bg-blue-500";
            if (player.is_newcomer) color = "bg-blue-700 hover:bg-blue-800";

            return (
              <TableRow key={player.id} className={color}>
                <TableCell className="font-medium">
                  <PlayerRoleIcon role={player.role} />
                </TableCell>
                <TableCell>
                  <PlayerName player={player} includeSpecialization={false} excludeBadge={true} />
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
                <TableCell className={color_shift}>{player.points}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};

const TeamAnalyticsCard = ({ team }: { team: TeamAnalytics }) => {
 const color = useMemo(
   () => {
     let color = "text-group-a";

     if (team.group?.name == "B") color = "text-group-b";
     if (team.group?.name == "C") color = "text-group-c";
     if (team.group?.name == "D") color = "text-group-d";
     return color
   }, [team]
 )

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

const TeamAnalyticsTable = ({
  teams,
  isLoading
}: {
  teams: TeamAnalytics[];
  isLoading: boolean;
}) => {
  return (
    <div className="grid grid-cols-2 xs:grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
      {isLoading ? (
        <>
          <TournamentTeamCardSkeleton />
          <TournamentTeamCardSkeleton />
          <TournamentTeamCardSkeleton />
          <TournamentTeamCardSkeleton />
          <TournamentTeamCardSkeleton />
          <TournamentTeamCardSkeleton />
        </>
      ) : (
        teams.map((team) => <TeamAnalyticsCard key={team.id} team={team} />)
      )}
    </div>
  );
};

export default TeamAnalyticsTable;
