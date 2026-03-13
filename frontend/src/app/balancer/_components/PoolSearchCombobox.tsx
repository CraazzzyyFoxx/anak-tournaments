"use client";

import { useMemo, useState } from "react";
import { Plus, Search, UserCheck } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { BalancerApplication, BalancerPlayerRecord } from "@/types/balancer-admin.types";
import { playerHasRankedRole } from "@/app/balancer/_components/workspace-helpers";

type PoolSearchComboboxProps = {
  players: BalancerPlayerRecord[];
  applications: BalancerApplication[];
  onSelectPlayer: (playerId: number) => void;
  onAddFromApplication: (application: BalancerApplication) => void;
  disabled?: boolean;
};

function buildPlayerSearchValue(player: BalancerPlayerRecord): string {
  return player.battle_tag;
}

function buildApplicationSearchValue(application: BalancerApplication): string {
  return `${application.battle_tag} ${application.discord_nick ?? ""} ${application.twitch_nick ?? ""}`;
}

function formatPlayerRoles(player: BalancerPlayerRecord): string {
  const ranked = player.role_entries_json
    .filter((entry) => entry.rank_value !== null)
    .map((entry) => {
      const labels: Record<string, string> = { tank: "T", dps: "D", support: "S" };
      return labels[entry.role] ?? entry.role;
    });
  return ranked.length > 0 ? ranked.join("/") : "—";
}

function formatApplicationRoles(application: BalancerApplication): string {
  return [application.primary_role, ...application.additional_roles_json].filter(Boolean).join(" / ") || "No roles";
}

export function PoolSearchCombobox({
  players,
  applications,
  onSelectPlayer,
  onAddFromApplication,
  disabled = false,
}: PoolSearchComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [hideAdded, setHideAdded] = useState(false);

  const poolPlayers = useMemo(() => players.filter((p) => p.is_in_pool), [players]);
  const visiblePoolPlayers = useMemo(
    () => (hideAdded ? [] : poolPlayers),
    [hideAdded, poolPlayers],
  );

  const addableApplications = useMemo(
    () => applications.filter((app) => app.is_active && app.player === null),
    [applications],
  );

  const hasResults = visiblePoolPlayers.length > 0 || addableApplications.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-start gap-2 text-muted-foreground"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Search players or applications…</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <Command>
          <CommandInput
            value={searchValue}
            onValueChange={setSearchValue}
            placeholder="Search by BattleTag…"
          />
          <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
            <Checkbox
              id="hide-added-pool-players"
              checked={hideAdded}
              onCheckedChange={(checked) => setHideAdded(Boolean(checked))}
            />
            <Label htmlFor="hide-added-pool-players" className="cursor-pointer font-normal text-muted-foreground">
              Hide already added
            </Label>
          </div>
          <CommandList>
            {!hasResults && <CommandEmpty>No players or applications found.</CommandEmpty>}

            {visiblePoolPlayers.length > 0 && (
              <CommandGroup heading="Pool Players">
                {visiblePoolPlayers.map((player) => {
                  const valid = playerHasRankedRole(player);
                  return (
                    <CommandItem
                      key={`pool-${player.id}`}
                      value={buildPlayerSearchValue(player)}
                      onSelect={() => {
                        onSelectPlayer(player.id);
                        setOpen(false);
                        setSearchValue("");
                      }}
                    >
                      <UserCheck className="mr-2 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{player.battle_tag}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          Roles: {formatPlayerRoles(player)}
                        </div>
                      </div>
                      {valid ? (
                        <Badge variant="outline" className="ml-2 shrink-0 text-[10px]">
                          Ready
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="ml-2 shrink-0 text-[10px]">
                          Needs rank
                        </Badge>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {addableApplications.length > 0 && (
              <CommandGroup heading="Applications (not in pool)">
                {addableApplications.map((application) => (
                  <CommandItem
                    key={`app-${application.id}`}
                    value={buildApplicationSearchValue(application)}
                    onSelect={() => {
                      onAddFromApplication(application);
                      setOpen(false);
                      setSearchValue("");
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{application.battle_tag}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {formatApplicationRoles(application)}
                      </div>
                    </div>
                    <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">Add to pool</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
