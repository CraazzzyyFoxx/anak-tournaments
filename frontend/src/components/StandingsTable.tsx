import React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Encounter } from "@/types/encounter.types";
import { Standings } from "@/types/tournament.types";
import { cn } from "@/lib/utils";

export interface StandingTableProps {
  standings: Standings[];
  is_groups: boolean;
}

function getStandingResult(teamId: number, encounter: Encounter) {
  const teamScore =
    encounter.home_team_id === teamId ? encounter.score.home : encounter.score.away;
  const opponentScore =
    encounter.home_team_id === teamId ? encounter.score.away : encounter.score.home;

  if (teamScore === opponentScore) {
    return {
      label: "T",
      score: `${teamScore}-${opponentScore}`,
      classes:
        "border-slate-400/20 bg-slate-400/15 text-slate-200",
    };
  }

  if (teamScore > opponentScore) {
    return {
      label: "W",
      score: `${teamScore}-${opponentScore}`,
      classes:
        "border-emerald-400/25 bg-emerald-400/18 text-emerald-100",
    };
  }

  return {
    label: "L",
    score: `${teamScore}-${opponentScore}`,
    classes:
      "border-rose-400/25 bg-rose-400/18 text-rose-100",
  };
}

function getPlacementClasses(position: number) {
  if (position === 1) {
    return "border-amber-300/30 bg-amber-300/12 text-amber-100";
  }

  if (position === 2) {
    return "border-slate-300/20 bg-slate-300/10 text-slate-100";
  }

  if (position === 3) {
    return "border-orange-300/25 bg-orange-300/12 text-orange-100";
  }

  return "border-white/10 bg-white/[0.04] text-white/70";
}

function getGroupTextClass(groupName: string | null | undefined) {
  switch (groupName?.trim().toLowerCase()) {
    case "a":
      return "text-sky-200";
    case "b":
      return "text-violet-200";
    case "c":
      return "text-emerald-200";
    case "d":
      return "text-amber-200";
    default:
      return "text-white";
  }
}

export const StandingEncounterCard = ({
  team_id,
  encounter,
}: {
  encounter: Encounter;
  team_id: number;
}) => {
  const result = getStandingResult(team_id, encounter);

  return (
    <div
      title={result.score}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border text-xs font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors",
        result.classes
      )}
    >
      {result.label}
    </div>
  );
};

const StandingsTable = ({ standings, is_groups }: StandingTableProps) => {
  const sortedStandings = [...standings].sort((a, b) => {
    const leftPosition = is_groups ? a.position : a.overall_position;
    const rightPosition = is_groups ? b.position : b.overall_position;

    return leftPosition - rightPosition;
  });

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
      <Table className="min-w-[860px]">
        <TableHeader className="bg-white/[0.03]">
          <TableRow className="border-white/[0.06] hover:bg-white/[0.03]">
            {is_groups ? (
              <>
                <TableHead className="h-11 w-[76px] px-4 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Pos
                </TableHead>
                <TableHead className="h-11 min-w-[260px] px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Team
                </TableHead>
                <TableHead className="h-11 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Record
                </TableHead>
                <TableHead className="h-11 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Pts
                </TableHead>
                <TableHead className="h-11 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  TB
                </TableHead>
                <TableHead className="h-11 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Buchholz
                </TableHead>
                <TableHead className="h-11 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Diff
                </TableHead>
                <TableHead className="h-11 min-w-[220px] px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Form
                </TableHead>
              </>
            ) : (
              <>
                <TableHead className="h-11 w-[76px] px-4 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Pos
                </TableHead>
                <TableHead className="h-11 min-w-[260px] px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Team
                </TableHead>
                <TableHead className="h-11 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  MP
                </TableHead>
                <TableHead className="h-11 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  W
                </TableHead>
                <TableHead className="h-11 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  D
                </TableHead>
                <TableHead className="h-11 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  L
                </TableHead>
                <TableHead className="h-11 min-w-[220px] px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Form
                </TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>

        <TableBody>
          {sortedStandings.map((standing) => {
            const position = is_groups ? standing.position : standing.overall_position;
            const teamColorClass = !is_groups
              ? getGroupTextClass(standing.team?.group?.name)
              : "text-white";
            const history = [...(standing.matches_history ?? [])].sort(
              (a, b) => a.round - b.round
            );

            return (
              <TableRow
                key={`${standing.stage_item_id ?? standing.stage_id ?? "standings"}-${standing.team_id}`}
                className="border-white/[0.06] hover:bg-white/[0.025]"
              >
                {is_groups ? (
                  <>
                    <TableCell className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          "inline-flex min-w-10 items-center justify-center rounded-full border px-2.5 py-1 text-sm font-semibold",
                          getPlacementClasses(position)
                        )}
                      >
                        {position}
                      </span>
                    </TableCell>

                    <TableCell className="px-4 py-3">
                      <div className="flex min-w-0 flex-col">
                        <span className={cn("truncate text-sm font-semibold", teamColorClass)}>
                          {standing.team?.name}
                        </span>
                        {standing.team?.group?.name && (
                          <span className="mt-0.5 text-xs text-white/35">
                            Group {standing.team.group.name}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="px-3 py-3 text-center text-sm font-medium text-white/82">
                      {standing.win}-{standing.lose}-{standing.draw}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-center text-sm font-semibold text-white">
                      {standing.points.toFixed(1)}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-center text-sm text-white/78">
                      {standing.tb ?? "-"}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-center text-sm text-white/78">
                      {standing.buchholz != null ? standing.buchholz.toFixed(1) : "-"}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-center text-sm text-white/78">
                      {standing.win * 2 - standing.lose}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {history.map((encounter) => (
                          <StandingEncounterCard
                            key={encounter.id}
                            team_id={standing.team_id}
                            encounter={encounter}
                          />
                        ))}
                      </div>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          "inline-flex min-w-10 items-center justify-center rounded-full border px-2.5 py-1 text-sm font-semibold",
                          getPlacementClasses(position)
                        )}
                      >
                        {position}
                      </span>
                    </TableCell>

                    <TableCell className="px-4 py-3">
                      <div className="flex min-w-0 flex-col">
                        <span className={cn("truncate text-sm font-semibold", teamColorClass)}>
                          {standing.team?.name}
                        </span>
                        {standing.team?.group?.name && (
                          <span className="mt-0.5 text-xs text-white/35">
                            Group {standing.team.group.name}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="px-3 py-3 text-center text-sm text-white/82">
                      {standing.matches}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-center text-sm text-white/82">
                      {standing.win}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-center text-sm text-white/82">
                      {standing.draw}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-center text-sm text-white/82">
                      {standing.lose}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {history.map((encounter) => (
                          <StandingEncounterCard
                            key={encounter.id}
                            team_id={standing.team_id}
                            encounter={encounter}
                          />
                        ))}
                      </div>
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default StandingsTable;
