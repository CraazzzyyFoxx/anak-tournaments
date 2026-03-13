"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import { BalancerApplication, BalancerPlayerRecord } from "@/types/balancer-admin.types";
import { getPlayerValidationIssues, playerHasRankedRole } from "@/app/balancer/_components/workspace-helpers";

const ROLE_DISPLAY: Record<string, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
};

const SUBTYPE_DISPLAY: Record<string, string> = {
  hitscan: "Hitscan",
  projectile: "Projectile",
  main_heal: "Main heal",
  light_heal: "Light heal",
};

type SortField = "name" | "division" | "added";
type SortDir = "asc" | "desc";

type PoolPlayerCompactListProps = {
  players: BalancerPlayerRecord[];
  applications?: BalancerApplication[];
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

function buildPoolPlayerSearchValue(player: BalancerPlayerRecord): string {
  const roleText = player.role_entries_json
    .flatMap((entry) => [entry.role, ROLE_DISPLAY[entry.role]?.toLowerCase() ?? "", entry.subtype ?? "", entry.division_number?.toString() ?? ""])
    .join(" ");

  return `${player.battle_tag} ${player.battle_tag_normalized} ${roleText}`.toLowerCase();
}

export function PoolPlayerCompactList({
  players,
  applications = [],
  editingPlayerId,
  onSelectPlayer,
  maxHeightClassName = "max-h-[32rem]",
}: PoolPlayerCompactListProps) {
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchValue, setSearchValue] = useState("");
  const [showOnlyPlayersWithProblems, setShowOnlyPlayersWithProblems] = useState(false);
  const fillsAvailableHeight = maxHeightClassName.split(/\s+/).includes("flex-1");
  const normalizedSearchValue = searchValue.trim().toLowerCase();
  const applicationsById = useMemo(
    () => new Map(applications.map((application) => [application.id, application])),
    [applications],
  );
  const totalPoolPlayerCount = useMemo(
    () => players.filter((player) => player.is_in_pool).length,
    [players],
  );

  function handleSortClick(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const poolPlayerStates = useMemo(
    () =>
      players
        .filter((player) => player.is_in_pool)
        .map((player) => ({
          player,
          issues: getPlayerValidationIssues(player, applicationsById.get(player.application_id) ?? null),
        })),
    [applicationsById, players],
  );

  const problemPlayerCount = useMemo(
    () => poolPlayerStates.filter((state) => state.issues.length > 0).length,
    [poolPlayerStates],
  );

  const poolPlayers = useMemo(
    () =>
      sortPlayers(
        poolPlayerStates
          .filter((state) => !showOnlyPlayersWithProblems || state.issues.length > 0)
          .map((state) => state.player),
        sortField,
        sortDir,
      ),
    [poolPlayerStates, showOnlyPlayersWithProblems, sortDir, sortField],
  );

  const issuesByPlayerId = useMemo(
    () => new Map(poolPlayerStates.map((state) => [state.player.id, state.issues])),
    [poolPlayerStates],
  );

  const filteredPoolPlayers = useMemo(() => {
    if (!normalizedSearchValue) {
      return poolPlayers;
    }

    return poolPlayers.filter((player) => buildPoolPlayerSearchValue(player).includes(normalizedSearchValue));
  }, [normalizedSearchValue, poolPlayers]);

  if (totalPoolPlayerCount === 0) {
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
    <div className={cn("flex flex-col gap-1.5", fillsAvailableHeight && "min-h-0 flex-1")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Find player in pool..."
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
        <Checkbox
          id="show-pool-problem-players"
          checked={showOnlyPlayersWithProblems}
          onCheckedChange={(checked) => setShowOnlyPlayersWithProblems(checked === true)}
        />
        <Label htmlFor="show-pool-problem-players" className="cursor-pointer font-normal text-xs">
          Show only players with problems {problemPlayerCount > 0 ? `(${problemPlayerCount})` : ""}
        </Label>
      </div>
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
        <span className="ml-auto text-[11px] text-muted-foreground">
          {filteredPoolPlayers.length}/{poolPlayers.length}
          {showOnlyPlayersWithProblems ? ` · ${Math.max(totalPoolPlayerCount - poolPlayers.length, 0)} hidden` : ""}
        </span>
      </div>
      <ScrollArea className={cn("min-h-0", maxHeightClassName)}>
        {filteredPoolPlayers.length === 0 ? (
          <div className="py-6 pr-3 text-center text-sm text-muted-foreground">
            {showOnlyPlayersWithProblems
              ? searchValue.trim()
                ? `No problem players match "${searchValue.trim()}".`
                : "No players with problems right now."
              : `No pool players match "${searchValue.trim()}".`}
          </div>
        ) : (
          <div className="space-y-1.5 pr-3">
            {filteredPoolPlayers.map((player) => {
              const isEditing = player.id === editingPlayerId;
              const issues = issuesByPlayerId.get(player.id) ?? [];
              const isValid = issues.length === 0 && playerHasRankedRole(player);
              const sortedEntries = [...player.role_entries_json].sort((a, b) => a.priority - b.priority);
              const rankedRoles = sortedEntries.filter((entry) => entry.rank_value !== null);
              const primaryEntry = rankedRoles[0] ?? sortedEntries[0] ?? null;
              const divisionNumber = primaryEntry?.division_number ?? null;
              const roleSummary = rankedRoles.length > 0
                ? rankedRoles
                    .map((entry) => `${ROLE_DISPLAY[entry.role] ?? entry.role}${entry.subtype ? ` (${SUBTYPE_DISPLAY[entry.subtype] ?? entry.subtype})` : ""}`)
                    .join(" · ")
                : "No ranked roles";
              const issueSummary = issues.map((issue) => issue.message).join(" · ");

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
                      title={isValid ? "Player is ready" : issueSummary || "Player has validation issues"}
                    />
                    <div className="min-w-0 flex flex-1 items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <div className="truncate text-sm font-medium">{player.battle_tag}</div>
                          {divisionNumber !== null && (
                            <PlayerDivisionIcon division={divisionNumber} width={24} height={24} />
                          )}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{roleSummary}</div>
                        {issues.length > 0 ? (
                          <div className="truncate text-[11px] text-amber-600">{issueSummary}</div>
                        ) : null}
                      </div>
                    </div>
                    {rankedRoles.length > 0 ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        {rankedRoles.map((entry) => (
                          <PlayerRoleIcon
                            key={`${entry.role}-${entry.subtype ?? "none"}`}
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
        )}
      </ScrollArea>
    </div>
  );
}
