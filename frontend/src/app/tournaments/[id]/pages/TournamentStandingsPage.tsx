import React, { Suspense } from "react";
import tournamentService from "@/services/tournament.service";
import { Standings, Tournament } from "@/types/tournament.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StandingsTable from "@/components/StandingsTable";
import { cn } from "@/lib/utils";

const TournamentStandingsPage = async ({ tournament }: { tournament: Tournament }) => {
  const standings = await tournamentService.getStandings(tournament.id);

  const groups: Record<number, string> = {};
  const groupStandings: Record<number, Standings[]> = {};
  const groupStandingsList: Standings[] = standings.filter((standing) => standing.group?.is_groups);
  const playoffStandings = standings.filter((standing) => !standing.group?.is_groups);

  standings.forEach((standing) => {
    if (standing.group?.is_groups) {
      groups[standing.group_id] = standing.group.name;
      groupStandings[standing.group_id] = [];
    }
  });

  for (const standing of groupStandingsList) {
    groupStandings[standing.group_id].push(standing);
  }

  return (
    <Suspense>
      <div className="flex flex-col gap-8">
        {playoffStandings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="scroll-m-20 text-2xl font-semibold tracking-tight">
                Playoff Standings
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <StandingsTable standings={playoffStandings} is_groups={false} />
            </CardContent>
          </Card>
        )}
        {Object.keys(groups).map((groupId) => {
          const color = "text-group-" + groups[Number(groupId)].toLowerCase();

          return (
            <Card key={groupId}>
              <CardHeader>
                <CardTitle
                  className={cn(color, "scroll-m-20 text-2xl font-semibold tracking-tight")}
                >
                  Group {groups[Number(groupId)]}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <StandingsTable standings={groupStandings[Number(groupId)]} is_groups={true} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </Suspense>
  );
};

export default TournamentStandingsPage;
