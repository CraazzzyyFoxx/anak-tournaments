import React from "react";
import { sortTeamPlayers } from "@/utils/player";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { CircleMinus, CirclePlus, CornerDownRight } from "lucide-react";
import PlayerName from "@/components/PlayerName";
import { Player, Team } from "@/types/team.types";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import { cn } from "@/lib/utils";
import type { DivisionGridVersion } from "@/types/workspace.types";

export const TournamentTeamCardSkeleton = () => {
  return <Skeleton className="h-[380px] w-full rounded-xl" />;
};

export const TournamentTeamTable = ({
  players,
  tournamentGrid,
}: {
  players: Player[];
  tournamentGrid?: DivisionGridVersion | null;
}) => {
  const sortedPlayers = sortTeamPlayers(players);

  return (
    <ScrollArea>
      <Table>
        <TableHeader>
          <TableRow className="border-white/[0.06] hover:bg-transparent">
            <TableHead className="h-8 text-[10px] uppercase tracking-wide text-white/35 font-semibold">Role</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wide text-white/35 font-semibold">Battle tag</TableHead>
            <TableHead className="h-8 text-center text-[10px] uppercase tracking-wide text-white/35 font-semibold">Division</TableHead>
            <TableHead className="h-8 text-center text-[10px] uppercase tracking-wide text-white/35 font-semibold">New</TableHead>
            <TableHead className="h-8 text-center text-[10px] uppercase tracking-wide text-white/35 font-semibold">Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedPlayers.map((player) => (
            <TableRow key={player.id} className="border-white/[0.04] hover:bg-white/[0.02]">
              <TableCell className="py-2 font-medium">
                {player.is_substitution ? (
                  <CornerDownRight className="ml-2.5 h-4 w-4 text-white/40" />
                ) : (
                  <PlayerRoleIcon role={player.role} />
                )}
              </TableCell>
              <TableCell className="py-2">
                <PlayerName player={player} includeSpecialization={true} />
              </TableCell>
              <TableCell className="py-2">
                <PlayerDivisionIcon division={player.division} width={32} height={32} tournamentGrid={tournamentGrid} />
              </TableCell>
              <TableCell className="py-2">
                <div className="flex justify-center">
                  {player.is_newcomer ? (
                    <CirclePlus className="h-5 w-5 text-red-400" />
                  ) : (
                    <CircleMinus className="h-5 w-5 text-white/40" />
                  )}
                </div>
              </TableCell>
              <TableCell className="py-2">
                <div className="flex justify-center">
                  {player.is_newcomer_role ? (
                    <CirclePlus className="h-5 w-5 text-red-400" />
                  ) : (
                    <CircleMinus className="h-5 w-5 text-white/40" />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};

const placementStyle = (placement: number) => {
  if (placement === 1) return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  if (placement === 2) return "text-slate-300 bg-slate-400/10 border-slate-400/25";
  if (placement === 3) return "text-orange-400 bg-orange-500/10 border-orange-500/25";
  return "text-white/65 bg-white/[0.05] border-white/[0.12]";
};

export const TournamentTeamCard = ({ team }: { team: Team }) => {
  const groupTextColor =
    team.group?.name === "B" ? "text-group-b" :
    team.group?.name === "C" ? "text-group-c" :
    team.group?.name === "D" ? "text-group-d" :
    "text-group-a";

  const groupBgBorder =
    team.group?.name === "B" ? "bg-group-b/10 border-group-b/20" :
    team.group?.name === "C" ? "bg-group-c/10 border-group-c/20" :
    team.group?.name === "D" ? "bg-group-d/10 border-group-d/20" :
    "bg-group-a/10 border-group-a/20";

  return (
    <div id={team.id.toString()} className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-4">
        {/* Tags row: group chip left, placement right */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            {team.group?.name && (
              <span className={cn(
                "inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wide",
                groupTextColor,
                groupBgBorder
              )}>
                Group {team.group.name}
              </span>
            )}
          </div>
          {team.placement != null && (
            <span className={cn(
              "inline-flex items-center text-xs font-bold tabular-nums px-2.5 py-0.5 rounded-full border",
              placementStyle(team.placement)
            )}>
              #{team.placement}
            </span>
          )}
        </div>

        {/* Team name + avg SR */}
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-white leading-snug truncate">
            {team.name}
          </h3>
          <div className="shrink-0 text-right">
            <div className="text-[10px] text-white/35 uppercase tracking-wide leading-none mb-0.5">Avg. SR</div>
            <div className="text-sm font-semibold tabular-nums text-white/65">{team.avg_sr.toFixed(0)}</div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/[0.06]" />

      {/* Table */}
      <TournamentTeamTable players={team.players} tournamentGrid={team.tournament?.division_grid_version} />
    </div>
  );
};
