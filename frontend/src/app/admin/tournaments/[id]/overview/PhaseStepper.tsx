"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Tournament, TournamentStatus } from "@/types/tournament.types";
import { TournamentStatusControl } from "../components/TournamentStatusControl";
import { effectivePhases } from "./effective-phases";

const PHASE_LABELS: Record<TournamentStatus, string> = {
  registration: "Registration",
  check_in: "Check-in",
  draft: "Draft phase",
  live: "Live",
  playoffs: "Playoffs",
  completed: "Completed",
  archived: "Archived"
};

/**
 * Pipeline stepper over the effective phase chain (D19) with the existing
 * status actions embedded beside it. Optional phases (unscheduled check-in,
 * archived) render dashed until reached; a drifted status is appended by
 * `effectivePhases` and shows up as the current phase.
 */
export function PhaseStepper({ tournament }: Readonly<{ tournament: Tournament }>) {
  const phases = effectivePhases({
    teamFormation: tournament.team_formation,
    schedule: tournament.phase_schedule.map((entry) => entry.status),
    currentStatus: tournament.status
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 xl:flex-row xl:items-center xl:justify-between">
        <ol className="flex flex-wrap items-center gap-y-2">
          {phases.map((phase, index) => {
            const isCurrent = phase.key === tournament.status;
            return (
              <li key={phase.key} className="flex items-center">
                {index > 0 && (
                  <span
                    aria-hidden
                    className={cn("mx-1.5 h-px w-4", phase.reached ? "bg-primary/50" : "bg-border")}
                  />
                )}
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]",
                    isCurrent
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : phase.reached
                        ? "border-border/60 bg-muted/20 text-foreground"
                        : "border-border/60 bg-muted/10 text-muted-foreground",
                    phase.optional && !phase.reached && "border-dashed"
                  )}
                >
                  {PHASE_LABELS[phase.key] ?? phase.key}
                </span>
              </li>
            );
          })}
        </ol>
        <TournamentStatusControl tournament={tournament} />
      </CardContent>
    </Card>
  );
}
