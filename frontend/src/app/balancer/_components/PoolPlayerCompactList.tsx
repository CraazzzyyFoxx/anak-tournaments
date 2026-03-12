"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import { BalancerPlayerRecord } from "@/types/balancer-admin.types";
import { playerHasRankedRole } from "@/app/balancer/_components/workspace-helpers";

const ROLE_DISPLAY: Record<string, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
};

type SortField = "name" | "division" | "added";
type SortDir = "asc" | "desc";

type PoolPlayerCompactListProps = {
  players: BalancerPlayerRecord[];
  editingPlayerId?: number | null;
  onSelectPlayer?: (playerId: number | null) => void;
  maxHeightClassName?: string;
};

function getPrimaryDivision(player: BalancerPlayerRecord): number {
  if (player.role_entries_json.length === 0) return Infinity;
  const sorted = [...player.role_entries_json].sort((a, b) => a.priority - b.priority);
  return sorted[0].division_number ?? Infinity;
}

function sortPlayers(
  players: BalancerPlayerRecord[],
  field: SortField,
  dir: SortDir,
): BalancerPlayerRecord[] {
  const multiplier = dir === "asc" ? 1 : -1;
  return [...players].sort((a, b) => {
    if (field === "name") {
      return multiplier * a.battle_tag.localeCompare(b.battle_tag);
    }
    if (field === "division") {
      const da = getPrimaryDivision(a);
      const db = getPrimaryDivision(b);
      if (da === db) return 0;
      return multiplier * (da < db ? -1 : 1);
    }
    // field === "added" — use id as proxy
    return multiplier * (a.id - b.id);
  });
}

export function PoolPlayerCompactList({
  players,
  editingPlayerId,
  onSelectPlayer,
  maxHeightClassName = "max-h-[32rem]",
}: PoolPlayerCompactListProps) {
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSortClick(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const poolPlayers = sortPlayers(
    players.filter((p) => p.is_in_pool),
    sortField,
    sortDir,
  );

  if (poolPlayers.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No players in pool yet. Use the search above to add players from applications.
      </div>
    );
  }

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return <span className="ml-0.5 opacity-30">↕</span>;
    return <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="mr-1">Sort:</span>
        {(["name", "division", "added"] as SortField[]).map((field) => (
          <Button
            key={field}
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 px-2 py-0 text-xs capitalize",
              sortField === field && "bg-muted font-medium text-foreground",
            )}
            onClick={() => handleSortClick(field)}
          >
            {field}
            {sortIcon(field)}
          </Button>
        ))}
      </div>
    <ScrollArea className={cn("min-h-0", maxHeightClassName)}>
      <div className="space-y-1.5 pr-3">
        {poolPlayers.map((player) => {
          const isEditing = player.id === editingPlayerId;
          const isValid = playerHasRankedRole(player);
          const sortedEntries = [...player.role_entries_json].sort((a, b) => a.priority - b.priority);
          const rankedRoles = sortedEntries.filter((entry) => entry.rank_value !== null);
          const primaryEntry = sortedEntries[0] ?? null;
          const divisionNumber = primaryEntry?.division_number ?? null;

          return (
            <Card
              key={player.id}
              className={cn(
                "cursor-pointer border-border/60 bg-background/70 transition-colors hover:border-primary/30",
                isEditing && "border-primary/50 bg-primary/5 ring-1 ring-primary/30",
              )}
              onClick={onSelectPlayer ? () => onSelectPlayer(isEditing ? null : player.id) : undefined}
            >
              <CardContent className="flex items-center gap-2 p-2.5">
                <div
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    isValid ? "bg-green-500" : "bg-amber-500",
                  )}
                  title={isValid ? "Ranked roles configured" : "Needs rank data"}
                />
                <div className="min-w-0 flex-1 flex items-center gap-1.5">
                  <div className="truncate text-sm font-medium">{player.battle_tag}</div>
                  {divisionNumber !== null && (
                    <PlayerDivisionIcon division={divisionNumber} width={24} height={24} />
                  )}
                </div>
                {rankedRoles.length > 0 ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    {rankedRoles.map((entry) => (
                      <PlayerRoleIcon
                        key={entry.role}
                        role={ROLE_DISPLAY[entry.role] ?? entry.role}
                        size={16}
                      />
                    ))}
                  </div>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground">No ranks</span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
    </div>
  );
}
