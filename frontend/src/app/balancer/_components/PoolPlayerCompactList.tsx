"use client";

import { AlertTriangle, Check, Circle } from "lucide-react";

import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { BalancerPlayerRecord, BalancerRoleCode } from "@/types/balancer-admin.types";
import {
  ROLE_LABELS,
  isRoleEntryActive,
  type PlayerValidationIssue,
} from "@/app/balancer/_components/workspace-helpers";

type PoolPlayerCompactListProps = {
  playerStates: Array<{
    player: BalancerPlayerRecord;
    issues: PlayerValidationIssue[];
  }>;
  selectedPlayerId?: number | null;
  onSelectPlayer?: (playerId: number | null) => void;
  maxHeightClassName?: string;
  emptyTitle?: string;
  emptyDescription?: string;
};

const ROLE_TEXT_ACCENTS: Record<BalancerRoleCode, string> = {
  tank: "text-sky-300",
  dps: "text-orange-300",
  support: "text-emerald-300",
};

function sortRoleEntries(player: BalancerPlayerRecord) {
  return [...player.role_entries_json].sort((left, right) => left.priority - right.priority);
}

function splitBattleTag(battleTag: string): { name: string; suffix: string | null } {
  const hashIndex = battleTag.indexOf("#");
  if (hashIndex < 0) {
    return { name: battleTag, suffix: null };
  }

  return {
    name: battleTag.slice(0, hashIndex),
    suffix: battleTag.slice(hashIndex),
  };
}

function uniqueRoleCodes(roleCodes: BalancerRoleCode[]): BalancerRoleCode[] {
  return roleCodes.filter((roleCode, index) => roleCodes.indexOf(roleCode) === index);
}

function roleIconTitle(roleCode: BalancerRoleCode): string {
  return ROLE_LABELS[roleCode];
}

function RoleIconStrip({ roleCodes }: { roleCodes: BalancerRoleCode[] }) {
  if (roleCodes.length === 0) {
    return <span className="text-[11px] text-white/28">No roles</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {roleCodes.map((roleCode) => (
        <span key={roleCode} title={roleIconTitle(roleCode)} className="opacity-95">
          <PlayerRoleIcon role={ROLE_LABELS[roleCode]} size={15} />
        </span>
      ))}
    </div>
  );
}

export function PoolPlayerCompactList({
  playerStates,
  selectedPlayerId,
  onSelectPlayer,
  maxHeightClassName = "max-h-[32rem]",
  emptyTitle = "No players match the current filters",
  emptyDescription = "Try another search or change the pool filter.",
}: PoolPlayerCompactListProps) {
  if (playerStates.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-white/88">{emptyTitle}</p>
          <p className="text-xs text-white/38">{emptyDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className={cn("min-h-0", maxHeightClassName)}>
      <div className="space-y-1.5 pr-2">
        {playerStates.map(({ player, issues }) => {
          const isSelected = player.id === selectedPlayerId;
          const isValid = issues.length === 0;
          const sortedEntries = sortRoleEntries(player);
          const rankedEntries = sortedEntries.filter((entry) => isRoleEntryActive(entry) && entry.rank_value !== null);
          const rankedRoleCodes = uniqueRoleCodes(rankedEntries.map((entry) => entry.role));
          const primaryEntry = rankedEntries[0] ?? sortedEntries[0] ?? null;
          const divisionNumber = primaryEntry?.division_number ?? null;
          const { name, suffix } = splitBattleTag(player.battle_tag);
          const primaryRole = primaryEntry?.role ?? null;
          const issueSummary = issues.map((issue) => issue.message).join(" | ");

          return (
            <button
              key={player.id}
              type="button"
              title={issueSummary || player.battle_tag}
              aria-pressed={isSelected}
              onClick={onSelectPlayer ? () => onSelectPlayer(player.id) : undefined}
              className={cn(
                "grid w-full grid-cols-[20px_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-all",
                "border-white/6 bg-white/[0.02] hover:border-white/12 hover:bg-white/[0.04]",
                isSelected && "border-violet-400/45 bg-violet-500/[0.08] shadow-[0_0_0_1px_rgba(139,92,246,0.18)]",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-md border text-[10px]",
                  isSelected
                    ? "border-violet-300/50 bg-violet-500/18 text-violet-100"
                    : "border-white/10 bg-black/15 text-white/55",
                )}
              >
                {isSelected ? <Check className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5 fill-current stroke-none" />}
              </span>

              <RoleIconStrip roleCodes={rankedRoleCodes} />

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-white/88">{name}</span>
                  {suffix ? <span className="shrink-0 text-[12px] text-white/28">{suffix}</span> : null}
                  {!isValid ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" /> : null}
                  {player.is_flex ? (
                    <Badge className="h-5 shrink-0 rounded-full border-violet-300/20 bg-violet-500/12 px-1.5 text-[9px] uppercase tracking-[0.14em] text-violet-200 hover:bg-violet-500/12">
                      Flex
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {divisionNumber != null ? (
                  <span className="shrink-0" title={`Division ${divisionNumber}`}>
                    <PlayerDivisionIcon division={divisionNumber} width={20} height={20} />
                  </span>
                ) : null}
                {primaryEntry?.rank_value != null ? (
                  <span
                    className={cn(
                      "min-w-10 text-right text-[13px] font-semibold tabular-nums text-cyan-300",
                      primaryRole && ROLE_TEXT_ACCENTS[primaryRole],
                    )}
                  >
                    {primaryEntry.rank_value}
                  </span>
                ) : (
                  <span className="text-[12px] text-white/24">-</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
