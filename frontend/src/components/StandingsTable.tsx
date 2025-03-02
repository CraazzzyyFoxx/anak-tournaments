import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Standings } from "@/types/tournament.types";
import { Encounter } from "@/types/encounter.types";
import { cn } from "@/lib/utils";

export interface StandingTableProps {
  standings: Standings[];
  is_groups: boolean;
}

export const StandingEncounterCard = ({
  team_id,
  encounter
}: {
  encounter: Encounter;
  team_id: number;
}) => {
  const homeScore = encounter.home_team_id == team_id ? encounter.score.home : encounter.score.away;
  const awayScore = encounter.away_team_id != team_id ? encounter.score.away : encounter.score.home;

  const result = homeScore == awayScore ? "T" : homeScore > awayScore ? "W" : "L";
  const color = result === "W" ? "bg-blue-600" : result === "T" ? "bg-gray-500" : "bg-red-500";

  return (
    <div className={`flex w-[32px] h-[32px] text-black ${color} rounded-sm text-lg font-semibold`}>
      <p className="mx-auto my-auto">{result}</p>
    </div>
  );
};

const StandingsTable = ({ standings, is_groups }: StandingTableProps) => {
  const sortedStandings = standings.sort((a, b) => a.position - b.position);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {is_groups ? (
            <>
              <TableHead className="w-[50px] text-center">№</TableHead>
              <TableHead className="w-[350px]">Team</TableHead>
              <TableHead className="text-center">W-L-T</TableHead>
              <TableHead className="text-center">Points</TableHead>
              <TableHead className="text-center">TB</TableHead>
              <TableHead className="text-center">Buchholz</TableHead>
              <TableHead className="text-center">Pts Diff</TableHead>
              <TableHead>Match History</TableHead>
            </>
          ) : (
            <>
              <TableHead className="w-[50px] text-center">№</TableHead>
              <TableHead className="w-[350px]">Team</TableHead>
              <TableHead className="text-center">Matches</TableHead>
              <TableHead className="text-center">W</TableHead>
              <TableHead className="text-center">D</TableHead>
              <TableHead className="text-center">L</TableHead>
              <TableHead>Match History</TableHead>
            </>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedStandings.map((standing) => {
          const position = is_groups ? standing.position : standing.overall_position;
          let color = "";
          if (!is_groups) {
            color = "text-group-" + standing.team?.group?.name.toLowerCase();
          }

          return (
            <TableRow key={`${standing.group_id}-${standing.team_id}`}>
              {is_groups ? (
                <>
                  <TableCell className="w-[50px] text-center">{position}</TableCell>
                  <TableCell className="w-[350px]">{standing.team?.name}</TableCell>
                  <TableCell className="text-center">
                    {standing.win} - {standing.lose} - {standing.draw}
                  </TableCell>
                  <TableCell className="text-center">{standing.points.toFixed(1)}</TableCell>
                  <TableCell className="text-center">{standing.tb}</TableCell>
                  <TableCell className="text-center">{standing.buchholz?.toFixed(1)}</TableCell>
                  <TableCell className="text-center">{standing.win * 2 - standing.lose}</TableCell>
                  <TableCell className="flex gap-2">
                    {standing.matches_history
                      .sort((a, b) => a.round - b.round)
                      ?.map((encounter) => (
                        <StandingEncounterCard
                          key={encounter.id}
                          team_id={standing.team_id}
                          encounter={encounter}
                        />
                      ))}
                  </TableCell>
                </>
              ) : (
                <>
                  <TableCell className={cn("w-[50px] text-center", color)}>{position}</TableCell>
                  <TableCell className={cn("w-[350px]", color)}>{standing.team?.name}</TableCell>
                  <TableCell className="text-center">{standing.matches}</TableCell>
                  <TableCell className="text-center">{standing.win}</TableCell>
                  <TableCell className="text-center">{standing.draw}</TableCell>
                  <TableCell className="text-center">{standing.lose}</TableCell>
                  <TableCell className="flex gap-2">
                    {standing.matches_history?.map((encounter) => (
                      <StandingEncounterCard
                        key={encounter.id}
                        team_id={standing.team_id}
                        encounter={encounter}
                      />
                    ))}
                  </TableCell>
                </>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

export default StandingsTable;
