"use client";

import { AlertTriangle } from "lucide-react";
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
 * Pipeline stepper over the effective phase chain (D19), and the workspace's
 * ONE status control. The header used to render a second copy of that control;
 * two identical badge + transition clusters mutating the same status left no
 * way to tell which was authoritative.
 *
 * Optional phases (unscheduled check-in, archived) render dashed until
 * reached. A force-transition can leave the tournament on a status outside the
 * chain; that phase is flagged `drifted` and rendered as an off-track marker
 * beside the chain rather than appended after the terminal phase.
 */
export function PhaseStepper({ tournament }: Readonly<{ tournament: Tournament }>) {
  const phases = effectivePhases({
    teamFormation: tournament.team_formation,
    schedule: tournament.phase_schedule.map((entry) => entry.status),
    currentStatus: tournament.status
  });
  const chain = phases.filter((phase) => !phase.drifted);
  const drifted = phases.find((phase) => phase.drifted);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ol className="flex flex-wrap items-center gap-y-2">
            {chain.map((phase, index) => {
              const isCurrent = !drifted && phase.key === tournament.status;
              return (
                <li key={phase.key} className="flex items-center">
                  {index > 0 && (
                    <span
                      aria-hidden
                      className={cn(
                        "mx-1.5 h-px w-4",
                        phase.reached ? "bg-primary/50" : "bg-border"
                      )}
                    />
                  )}
                  <span
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider",
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
          {drifted ? (
            <p
              aria-current="step"
              className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-warning"
            >
              <AlertTriangle className="size-3.5" aria-hidden />
              Off track: {PHASE_LABELS[drifted.key] ?? drifted.key}
            </p>
          ) : null}
        </div>
        <TournamentStatusControl tournament={tournament} />
      </CardContent>
    </Card>
  );
}
