"use client";

import { CircleAlert, Layers3, ListChecks, Trophy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { getTournamentWorkspacePhases } from "./tournamentWorkspace.helpers";

type MetricCount = number | null;

interface TournamentOverviewTabProps {
  stagesCount: number;
  teamsCount: MetricCount;
  teamsCountLoading: boolean;
  encountersCount: MetricCount;
  encountersCountLoading: boolean;
  standingsCount: MetricCount;
  standingsCountLoading: boolean;
  completedEncounterCount: MetricCount;
  hasChallongeSource: boolean;
}

function formatMetricCount(value: MetricCount, isLoading: boolean) {
  if (typeof value === "number") {
    return value.toString();
  }

  return isLoading ? "..." : "-";
}

export function TournamentOverviewTab({
  stagesCount,
  teamsCount,
  teamsCountLoading,
  encountersCount,
  encountersCountLoading,
  standingsCount,
  standingsCountLoading,
  completedEncounterCount,
  hasChallongeSource
}: TournamentOverviewTabProps) {
  const workspacePhases = getTournamentWorkspacePhases({
    stagesCount,
    teamsCount,
    encountersCount,
    standingsCount
  });

  return (
    <div className="space-y-4">
      <Card className="border-border/40">
        <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ListChecks className="size-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Setup Checklist</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusIcon
              icon={Layers3}
              label={hasChallongeSource ? "Challonge linked" : "No Challonge link"}
              variant={hasChallongeSource ? "success" : "muted"}
            />
            <Badge
              variant={
                completedEncounterCount != null && completedEncounterCount > 0
                  ? "secondary"
                  : "outline"
              }
            >
              {completedEncounterCount == null
                ? `${formatMetricCount(encountersCount, encountersCountLoading)} encounters`
                : `${completedEncounterCount} completed encounters`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-2">
            {workspacePhases.map((phase) => {
              const PhaseIcon = phase.icon;
              return (
                <div
                  key={phase.label}
                  className="rounded-xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="rounded-lg border border-border/60 bg-background/80 p-2">
                          <PhaseIcon className="size-4 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium">{phase.label}</p>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{phase.description}</p>
                    </div>
                    {phase.done ? (
                      <StatusIcon icon={Trophy} label="Done" variant="success" />
                    ) : (
                      <StatusIcon icon={CircleAlert} label="Pending" variant="muted" />
                    )}
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {phase.metrics.map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-lg border border-border/50 bg-background/60 px-3 py-2"
                      >
                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60">
                          {metric.label}
                        </p>
                        <p className="mt-1 text-sm font-medium">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {!hasChallongeSource ? (
            <Alert className="border-dashed border-border/70 bg-background/60">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>Sync helpers need a link source</AlertTitle>
              <AlertDescription>
                Add a Challonge slug to the tournament to enable sync buttons for imported data.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Stages</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stagesCount}</CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Teams</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatMetricCount(teamsCount, teamsCountLoading)}
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Encounters</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatMetricCount(encountersCount, encountersCountLoading)}
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Standings</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatMetricCount(standingsCount, standingsCountLoading)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
