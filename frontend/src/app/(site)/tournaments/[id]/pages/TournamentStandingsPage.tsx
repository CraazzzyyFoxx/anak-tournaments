import React, { Suspense } from "react";
import tournamentService from "@/services/tournament.service";
import { Standings, Tournament } from "@/types/tournament.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StandingsTable from "@/components/StandingsTable";
import { cn } from "@/lib/utils";

const TournamentStandingsPage = async ({ tournament }: { tournament: Tournament }) => {
  const standings = await tournamentService.getStandings(tournament.id);

  const stageStandings = new Map<number, { name: string; standings: Standings[] }>();
  const groupStandingsList = standings.filter((standing) =>
    ["round_robin", "swiss"].includes(standing.stage?.stage_type ?? "")
  );
  const playoffStandings = standings.filter((standing) =>
    ["single_elimination", "double_elimination"].includes(
      standing.stage?.stage_type ?? ""
    )
  );

  for (const standing of groupStandingsList) {
    const key = standing.stage_item_id ?? standing.stage_id;
    if (key == null) {
      continue;
    }
    const name =
      standing.stage_item?.name ?? standing.stage?.name ?? `Stage ${standing.stage_id}`;
    const bucket = stageStandings.get(key) ?? { name, standings: [] };
    bucket.standings.push(standing);
    stageStandings.set(key, bucket);
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
        {Array.from(stageStandings.entries()).map(([stageScopeId, bucket]) => {
          const color =
            bucket.name.trim().length === 1
              ? "text-group-" + bucket.name.toLowerCase()
              : "text-white";

          return (
            <Card key={stageScopeId}>
              <CardHeader>
                <CardTitle
                  className={cn(color, "scroll-m-20 text-2xl font-semibold tracking-tight")}
                >
                  {bucket.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <StandingsTable standings={bucket.standings} is_groups={true} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </Suspense>
  );
};

export default TournamentStandingsPage;
