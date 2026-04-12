"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { BracketView } from "@/components/BracketView";
import StandingsTable from "@/components/StandingsTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import encounterService from "@/services/encounter.service";
import tournamentService from "@/services/tournament.service";
import type { Encounter } from "@/types/encounter.types";
import type { Standings, Tournament, Stage } from "@/types/tournament.types";
import { cn } from "@/lib/utils";

interface TournamentBracketPageProps {
  tournament: Tournament;
  stages: Stage[];
}

function GroupStagePanel({
  stage,
  encounters,
  standings,
}: {
  stage: Stage;
  encounters: Encounter[];
  standings: Standings[];
}) {
  const hasStandings = standings.length > 0;

  return (
    <Tabs
      defaultValue={hasStandings ? "matches" : "matches"}
      className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]"
    >
      <div className="flex flex-col gap-3 border-b border-white/[0.06] bg-white/[0.03] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-white">{stage.name}</h3>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/35">
            {stage.stage_type.replace(/_/g, " ")}
          </p>
        </div>

        <TabsList className="h-auto justify-start rounded-xl border border-white/[0.08] bg-black/20 p-1 text-white/50">
          {hasStandings && (
            <TabsTrigger
              value="standings"
              className="rounded-lg px-4 py-2 text-sm data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-none"
            >
              Standings
            </TabsTrigger>
          )}
          <TabsTrigger
            value="matches"
            className="rounded-lg px-4 py-2 text-sm data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-none"
          >
            Bracket
          </TabsTrigger>
        </TabsList>
      </div>

      {hasStandings && (
        <TabsContent value="standings" className="mt-0">
          <div className="overflow-x-auto">
            <StandingsTable standings={[...standings]} is_groups={true} />
          </div>
        </TabsContent>
      )}

      <TabsContent value="matches" className="mt-0 p-4">
        <BracketView encounters={encounters} type={stage.stage_type} />
      </TabsContent>
    </Tabs>
  );
}

export default function TournamentBracketPage({
  tournament,
  stages,
}: TournamentBracketPageProps) {
  const searchParams = useSearchParams();
  const selectedStageParam = searchParams.get("stage");
  const viewParam = searchParams.get("view");

  const groupStages = stages.filter(
    (stage) =>
      stage.stage_type === "round_robin" || stage.stage_type === "swiss"
  );

  const eliminationStages = stages.filter(
    (stage) =>
      stage.stage_type === "single_elimination" ||
      stage.stage_type === "double_elimination"
  );

  const fallbackStage = eliminationStages[0] ?? stages[0];
  const requestedStageId = selectedStageParam ? Number(selectedStageParam) : null;
  const requestedStage = stages.find((stage) => stage.id === requestedStageId);
  const primaryStage = requestedStage ?? fallbackStage;
  const shouldShowGroupStage =
    viewParam === "groups" ||
    (!!requestedStage && groupStages.some((stage) => stage.id === requestedStage.id));
  const activeStages = shouldShowGroupStage
    ? groupStages
    : primaryStage
      ? [primaryStage]
      : [];

  const { data: allEncounters } = useQuery({
    queryKey: ["encounters", "tournament", tournament.id],
    queryFn: () => encounterService.getAll(1, "", tournament.id, -1),
  });

  const { data: allStandings = [] } = useQuery({
    queryKey: ["standings", tournament.id],
    queryFn: () => tournamentService.getStandings(tournament.id),
  });

  const encountersByStage = useMemo(() => {
    const map = new Map<number, Encounter[]>();

    for (const stage of activeStages) {
      map.set(
        stage.id,
        (allEncounters?.results ?? []).filter(
          (encounter) => encounter.stage_id === stage.id
        )
      );
    }

    return map;
  }, [activeStages, allEncounters?.results]);

  const standingsByStage = useMemo(() => {
    const map = new Map<number, Standings[]>();

    for (const standing of allStandings) {
      if (!["round_robin", "swiss"].includes(standing.stage?.stage_type ?? "")) {
        continue;
      }

      const stageId = standing.stage_id;
      if (!stageId) {
        continue;
      }

      const existing = map.get(stageId) ?? [];
      existing.push(standing);
      map.set(stageId, existing);
    }

    return map;
  }, [allStandings, groupStages]);

  const playoffStandings = useMemo(
    () =>
      allStandings.filter((standing) =>
        ["single_elimination", "double_elimination"].includes(
          standing.stage?.stage_type ?? ""
        )
      ),
    [allStandings]
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Bracket</h2>
          {shouldShowGroupStage && groupStages.length > 0 ? (
            <p className="mt-1 text-sm text-white/45">
              Group Stage ({groupStages.length} groups)
            </p>
          ) : activeStages[0] && (
            <p className="mt-1 text-sm text-white/45">
              {activeStages[0].name} ({activeStages[0].stage_type.replace(/_/g, " ")})
            </p>
          )}
        </div>
      </div>

      {activeStages.length > 0 ? (
        <div className="space-y-6">
          {activeStages.map((stage) => {
            const encounters = encountersByStage.get(stage.id) ?? [];
            const standings = standingsByStage.get(stage.id) ?? [];

            if (shouldShowGroupStage) {
              return (
                <GroupStagePanel
                  key={stage.id}
                  stage={stage}
                  encounters={encounters}
                  standings={standings}
                />
              );
            }

            if (encounters.length === 0) {
              return (
                <div
                  key={stage.id}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-8 text-center text-muted-foreground"
                >
                  No matches found for {stage.name}
                </div>
              );
            }

            const hasPlayoffStandings = playoffStandings.length > 0;

            return (
              <Tabs
                key={stage.id}
                defaultValue="bracket"
                className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]"
              >
                <div className="flex flex-col gap-3 border-b border-white/[0.06] bg-white/[0.03] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold text-white">{stage.name}</h3>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/35">
                      {stage.stage_type.replace(/_/g, " ")}
                    </p>
                  </div>

                  <TabsList className="h-auto justify-start rounded-xl border border-white/[0.08] bg-black/20 p-1 text-white/50">
                    {hasPlayoffStandings && (
                      <TabsTrigger
                        value="standings"
                        className="rounded-lg px-4 py-2 text-sm data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-none"
                      >
                        Standings
                      </TabsTrigger>
                    )}
                    <TabsTrigger
                      value="bracket"
                      className="rounded-lg px-4 py-2 text-sm data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-none"
                    >
                      Bracket
                    </TabsTrigger>
                  </TabsList>
                </div>

                {hasPlayoffStandings && (
                  <TabsContent value="standings" className="mt-0">
                    <div className="overflow-x-auto">
                      <StandingsTable standings={[...playoffStandings]} is_groups={false} />
                    </div>
                  </TabsContent>
                )}

                <TabsContent value="bracket" className="mt-0 p-4">
                  <BracketView encounters={encounters} type={stage.stage_type} />
                </TabsContent>
              </Tabs>
            );
          })}
        </div>
      ) : (
        <div className="py-12 text-center text-muted-foreground">
          {stages.length === 0
            ? "No stages configured for this tournament"
            : "No bracket matches found for the selected stage"}
        </div>
      )}
    </div>
  );
}
