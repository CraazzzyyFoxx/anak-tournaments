"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { DivisionRankPicker } from "@/app/balancer/components/DivisionRankPicker";
import { PANEL_CLASS } from "@/app/balancer/components/balancer-page-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/notify";
import { ROLE_LABELS, ROLES } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { customGameKeys, customGameService } from "@/services/custom-game.service";
import { workspacePlayerService, type WorkspacePlayer } from "@/services/workspace-player.service";

type MixGamesPanelProps = {
  workspaceId: number;
  canEdit: boolean;
  selectedGameId: number | null;
  onSelectGame: (gameId: number | null) => void;
  rosterIds: number[];
  knownPlayers: Map<number, WorkspacePlayer>;
};

export function MixGamesPanel({
  workspaceId,
  canEdit,
  selectedGameId,
  onSelectGame,
  rosterIds,
  knownPlayers,
}: Readonly<MixGamesPanelProps>) {
  const queryClient = useQueryClient();
  const [gameName, setGameName] = useState("");
  const [hostRanks, setHostRanks] = useState<Record<number, Record<string, number>>>({});

  const gamesQuery = useQuery({
    queryKey: customGameKeys.list(workspaceId),
    queryFn: () => customGameService.list(workspaceId),
  });
  const gameQuery = useQuery({
    queryKey: customGameKeys.one(workspaceId, selectedGameId ?? 0),
    queryFn: () => customGameService.get(workspaceId, selectedGameId as number),
    enabled: selectedGameId !== null,
  });

  const selectedGame = gameQuery.data;
  const games = gamesQuery.data ?? [];

  useEffect(() => {
    if (!selectedGame?.players) return;
    setHostRanks((current) => {
      const next = { ...current };
      for (const row of selectedGame.players ?? []) {
        if (next[row.workspace_player_id]) continue;
        next[row.workspace_player_id] = {};
      }
      return next;
    });
  }, [selectedGame]);

  const createGame = useMutation({
    mutationFn: () => customGameService.create(workspaceId, gameName.trim()),
    onSuccess: async (game) => {
      setGameName("");
      onSelectGame(game.id);
      await queryClient.invalidateQueries({ queryKey: customGameKeys.list(workspaceId) });
    },
    onError: (error) => notify.apiError(error),
  });

  const saveRoster = useMutation({
    mutationFn: () => customGameService.updateRoster(workspaceId, selectedGameId as number, rosterIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customGameKeys.one(workspaceId, selectedGameId as number) });
      notify.success("Roster saved");
    },
    onError: (error) => notify.apiError(error),
  });

  const saveHostRanks = useMutation({
    mutationFn: ({ playerId, ranks }: { playerId: number; ranks: Record<string, number> }) =>
      workspacePlayerService.setHostRanks(workspaceId, playerId, ranks),
    onError: (error) => notify.apiError(error),
  });

  const balanceGame = useMutation({
    mutationFn: () => customGameService.balance(workspaceId, selectedGameId as number),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customGameKeys.one(workspaceId, selectedGameId as number) });
      await queryClient.invalidateQueries({ queryKey: customGameKeys.list(workspaceId) });
      notify.success("Balanced");
    },
    onError: (error) => notify.apiError(error),
  });

  return (
    <div className={cn(PANEL_CLASS, "flex min-h-0 flex-col")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <p className="min-w-0 flex-1 text-sm font-medium">Mixes</p>
        {canEdit ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (gameName.trim()) createGame.mutate();
            }}
          >
            <Input
              value={gameName}
              onChange={(event) => setGameName(event.target.value)}
              placeholder="New mix name"
              className="h-8 w-44"
              aria-label="Custom game name"
            />
            <Button type="submit" size="sm" className="h-8" disabled={createGame.isPending || !gameName.trim()}>
              Create
            </Button>
          </form>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[220px_1fr]">
        <ul className="min-h-0 overflow-y-auto rounded-lg border border-border/60">
          {gamesQuery.isLoading ? (
            <li className="p-3">
              <Skeleton className="h-16 w-full" />
            </li>
          ) : null}
          {games.map((game) => (
            <li key={game.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/40",
                  selectedGameId === game.id && "bg-white/[0.04]",
                )}
                onClick={() => onSelectGame(game.id)}
              >
                <span className="truncate font-medium">{game.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{game.status}</span>
              </button>
            </li>
          ))}
          {games.length === 0 && !gamesQuery.isLoading ? (
            <li className="px-3 py-6 text-sm text-muted-foreground">No mixes yet.</li>
          ) : null}
        </ul>

        <div className="min-h-0 overflow-y-auto">
          {selectedGameId == null ? (
            <p className="text-sm text-muted-foreground">Select a mix, then click players in the sidebar to build the roster.</p>
          ) : gameQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium">{selectedGame?.name ?? "Mix"}</h2>
                {canEdit ? (
                  <>
                    <Button size="sm" variant="outline" disabled={saveRoster.isPending} onClick={() => saveRoster.mutate()}>
                      Save roster
                    </Button>
                    <Button size="sm" disabled={balanceGame.isPending} onClick={() => balanceGame.mutate()}>
                      Balance
                    </Button>
                  </>
                ) : null}
              </div>
              {rosterIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">Roster is empty. Click a player in the sidebar.</p>
              ) : (
                <ul className="space-y-2">
                  {rosterIds.map((playerId) => {
                    const player = knownPlayers.get(playerId);
                    const ranks = hostRanks[playerId] ?? {};
                    return (
                      <li key={playerId} className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 px-2 py-1.5">
                        <span className="min-w-32 flex-1 truncate text-sm">
                          {player?.display_name || player?.battle_tag || `#${playerId}`}
                        </span>
                        {ROLES.map((role) => (
                          <DivisionRankPicker
                            key={role.code}
                            rank={ranks[role.code] ?? player?.ranks[role.code] ?? null}
                            disabled={!canEdit || saveHostRanks.isPending}
                            label={`Host ${ROLE_LABELS[role.code]} ${player?.battle_tag ?? playerId}`}
                            onChange={(nextRank) => {
                              const next = { ...ranks };
                              if (nextRank == null) delete next[role.code];
                              else next[role.code] = nextRank;
                              setHostRanks((current) => ({ ...current, [playerId]: next }));
                              saveHostRanks.mutate({ playerId, ranks: next });
                            }}
                          />
                        ))}
                      </li>
                    );
                  })}
                </ul>
              )}
              {selectedGame?.result_json != null ? (
                <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs">
                  {JSON.stringify(selectedGame.result_json, null, 2)}
                </pre>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
