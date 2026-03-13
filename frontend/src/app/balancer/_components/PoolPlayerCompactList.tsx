"use client";

import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";

import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { BalancerPlayerRecord, BalancerRoleCode } from "@/types/balancer-admin.types";
import { ROLE_LABELS, type PlayerValidationIssue } from "@/app/balancer/_components/workspace-helpers";

type PoolPlayerCompactListProps = {
  playerStates: Array<{
    player: BalancerPlayerRecord;
    issues: PlayerValidationIssue[];
  }>;
  editingPlayerId?: number | null;
  onSelectPlayer?: (playerId: number | null) => void;
  maxHeightClassName?: string;
  emptyTitle?: string;
  emptyDescription?: string;
};

function sortRoleEntries(player: BalancerPlayerRecord) {
  return [...player.role_entries_json].sort((left, right) => left.priority - right.priority);
}

function uniqueRoleCodes(roleCodes: BalancerRoleCode[]): BalancerRoleCode[] {
  return roleCodes.filter((roleCode, index) => roleCodes.indexOf(roleCode) === index);
}

function RoleIconGroup({ roleCodes }: { roleCodes: BalancerRoleCode[] }) {
  if (roleCodes.length === 0) {
    return <span className="text-[11px] text-muted-foreground">None</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {roleCodes.map((roleCode) => (
        <span
          key={roleCode}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/90 shadow-sm"
          title={ROLE_LABELS[roleCode]}
        >
          <PlayerRoleIcon role={ROLE_LABELS[roleCode]} size={16} />
        </span>
      ))}
      <span className="sr-only">{roleCodes.map((roleCode) => ROLE_LABELS[roleCode]).join(", ")}</span>
    </div>
  );
}

function StatusBadge({ isValid }: { isValid: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-6 shrink-0 gap-1 rounded-full px-2.5 text-[10px] uppercase tracking-[0.14em]",
        isValid
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
      )}
    >
      {isValid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {isValid ? "Ready" : "Need Fix"}
    </Badge>
  );
}

export function PoolPlayerCompactList({
  playerStates,
  editingPlayerId,
  onSelectPlayer,
  maxHeightClassName = "max-h-[32rem]",
  emptyTitle = "No players match the current filters",
  emptyDescription = "Try another search or change the pool filter.",
}: PoolPlayerCompactListProps) {
  if (playerStates.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/15 px-4 py-8 text-center">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
          <p className="text-xs text-muted-foreground">{emptyDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className={cn("min-h-0", maxHeightClassName)}>
      <div className="space-y-2 pr-3">
        {playerStates.map(({ player, issues }) => {
          const isEditing = player.id === editingPlayerId;
          const isValid = issues.length === 0;
          const sortedEntries = sortRoleEntries(player);
          const rankedEntries = sortedEntries.filter((entry) => entry.rank_value !== null);
          const rankedRoleCodes = uniqueRoleCodes(rankedEntries.map((entry) => entry.role));
          const primaryEntry = rankedEntries[0] ?? sortedEntries[0] ?? null;
          const divisionNumber = primaryEntry?.division_number ?? null;
          const mismatchIssue = issues.find((issue) => issue.code === "application_role_mismatch");
          const missingRankIssue = issues.find((issue) => issue.code === "missing_ranked_role");
          const issueSummary = issues.map((issue) => issue.message).join(" | ");
          const ariaLabel = `${player.battle_tag}. ${isValid ? "Ready" : "Needs fixes"}${
            issueSummary ? `. ${issueSummary}` : ""
          }`;

          return (
            <button
              key={player.id}
              type="button"
              aria-label={ariaLabel}
              aria-pressed={isEditing}
              title={issueSummary || `${player.battle_tag} is ready`}
              onClick={onSelectPlayer ? () => onSelectPlayer(isEditing ? null : player.id) : undefined}
              className={cn(
                "w-full rounded-2xl border border-border/70 bg-background/85 p-3 text-left shadow-sm transition-all hover:border-primary/35 hover:bg-background",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isEditing && "border-primary/50 bg-primary/5 ring-1 ring-primary/25",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{player.battle_tag}</span>
                    {player.is_flex ? (
                      <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] uppercase tracking-[0.12em]">
                        Flex
                      </Badge>
                    ) : null}
                    {divisionNumber !== null ? (
                      <span
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-muted/30"
                        title={`Division ${divisionNumber}`}
                      >
                        <PlayerDivisionIcon division={divisionNumber} width={24} height={24} />
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium uppercase tracking-[0.12em] text-foreground/70">Ranked</span>
                    {rankedRoleCodes.length > 0 ? (
                      <RoleIconGroup roleCodes={rankedRoleCodes} />
                    ) : (
                      <span className="rounded-full border border-border/60 bg-muted/30 px-2 py-1">No ranked roles</span>
                    )}
                  </div>

                  {mismatchIssue ? (
                    <div
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-100"
                      title={mismatchIssue.message}
                    >
                      <span className="inline-flex items-center gap-1 font-medium uppercase tracking-[0.12em] text-amber-700 dark:text-amber-200">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Conflict
                      </span>
                      <span className="text-amber-700/80 dark:text-amber-200/80">Applied</span>
                      <RoleIconGroup roleCodes={mismatchIssue.applicationRoleCodes} />
                      <ArrowRight className="h-3.5 w-3.5 text-amber-700/70 dark:text-amber-200/70" />
                      <span className="text-amber-700/80 dark:text-amber-200/80">Balancer</span>
                      <RoleIconGroup roleCodes={mismatchIssue.playerRoleCodes} />
                    </div>
                  ) : null}

                  {missingRankIssue ? (
                    <div
                      className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-200"
                      title={missingRankIssue.message}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {missingRankIssue.message}
                    </div>
                  ) : null}
                </div>

                <StatusBadge isValid={isValid} />
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
