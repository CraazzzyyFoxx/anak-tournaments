"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { ROLE_LABELS, ROLES } from "@/lib/roles";
import { customGameKeys, customGameService } from "@/services/custom-game.service";
import {
  parseRoleRanks,
  workspacePlayerKeys,
  workspacePlayerService,
  type WorkspacePlayer,
} from "@/services/workspace-player.service";
import { useWorkspaceStore } from "@/stores/workspace.store";

function emptyRankDraft(player?: WorkspacePlayer): Record<string, string> {
  return Object.fromEntries(ROLES.map((role) => [role.code, player?.ranks[role.code]?.toString() ?? ""]));
}

export default function AdminPickupPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();
  const queryClient = useQueryClient();
  const canEdit = canAccessPermission("team.update", workspaceId);

  const [battleTag, setBattleTag] = useState("");
  const [rankDrafts, setRankDrafts] = useState<Record<number, Record<string, string>>>({});
  const [gameName, setGameName] = useState("");
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [rosterIds, setRosterIds] = useState<number[]>([]);
  const [hostRankDrafts, setHostRankDrafts] = useState<Record<number, Record<string, string>>>({});

  const playersQuery = useQuery({
    queryKey: workspacePlayerKeys.list(workspaceId ?? 0),
    queryFn: () => workspacePlayerService.list(workspaceId as number),
    enabled: workspaceId !== null,
  });

  const gamesQuery = useQuery({
    queryKey: customGameKeys.list(workspaceId ?? 0),
    queryFn: () => customGameService.list(workspaceId as number),
    enabled: workspaceId !== null,
  });

  const gameQuery = useQuery({
    queryKey: customGameKeys.one(workspaceId ?? 0, selectedGameId ?? 0),
    queryFn: () => customGameService.get(workspaceId as number, selectedGameId as number),
    enabled: workspaceId !== null && selectedGameId !== null,
  });

  const players = playersQuery.data ?? [];
  const games = gamesQuery.data ?? [];
  const selectedGame = gameQuery.data;

  useEffect(() => {
    if (!selectedGame?.players) return;
    setRosterIds(selectedGame.players.map((row) => row.workspace_player_id));
  }, [selectedGame]);

  const addPlayer = useMutation({
    mutationFn: () => workspacePlayerService.upsert(workspaceId as number, battleTag.trim()),
    onSuccess: async () => {
      setBattleTag("");
      await queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.list(workspaceId as number) });
    },
    onError: (error) => notify.apiError(error),
  });


  const saveRanks = useMutation({
    mutationFn: ({ playerId, ranks }: { playerId: number; ranks: Record<string, number> }) =>
      workspacePlayerService.setRanks(workspaceId as number, playerId, ranks),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.list(workspaceId as number) });
      notify.success("Ranks saved");
    },
    onError: (error) => notify.apiError(error),
  });

  const createGame = useMutation({
    mutationFn: () => customGameService.create(workspaceId as number, gameName.trim()),
    onSuccess: async (game) => {
      setGameName("");
      setSelectedGameId(game.id);
      await queryClient.invalidateQueries({ queryKey: customGameKeys.list(workspaceId as number) });
    },
    onError: (error) => notify.apiError(error),
  });


  const saveRoster = useMutation({
    mutationFn: () => customGameService.updateRoster(workspaceId as number, selectedGameId as number, rosterIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: customGameKeys.one(workspaceId as number, selectedGameId as number),
      });
      notify.success("Roster saved");
    },
    onError: (error) => notify.apiError(error),
  });

  const balanceGame = useMutation({
    mutationFn: async () => {
      for (const playerId of rosterIds) {
        const ranks = parseRoleRanks(hostRankDrafts[playerId] ?? {});
        if (Object.keys(ranks).length > 0) {
          await workspacePlayerService.setHostRanks(workspaceId as number, playerId, ranks);
        }
      }
      return customGameService.balance(workspaceId as number, selectedGameId as number);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: customGameKeys.one(workspaceId as number, selectedGameId as number),
      });
      await queryClient.invalidateQueries({ queryKey: customGameKeys.list(workspaceId as number) });
      notify.success("Balanced");
    },
    onError: (error) => notify.apiError(error),
  });

  if (workspaceId === null) {
    return (
      <div className="space-y-6">
        <AdminPageHeader title="Pickup" description="Select a workspace to manage pickup players and custom games." />
        <p className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
          Pick a workspace in the sidebar to manage pickup players.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Pickup"
        description="Workspace players and custom games for pickup balancing."
      />

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Workspace players</h2>
          </CardTitle>
          <CardDescription>Ghosts by battle tag. Canon ranks are tank / DPS / support.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (battleTag.trim()) addPlayer.mutate();
              }}
            >
              <Input
                value={battleTag}
                onChange={(event) => setBattleTag(event.target.value)}
                placeholder="Name#1234"
                className="max-w-xs"
                aria-label="Battle tag"
              />
              <Button type="submit" size="sm" disabled={addPlayer.isPending || !battleTag.trim()}>
                Add player
              </Button>
            </form>
          ) : null}

          {playersQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Battle tag</TableHead>
                  {ROLES.map((role) => (
                    <TableHead key={role.code}>{ROLE_LABELS[role.code]}</TableHead>
                  ))}
                  {canEdit ? <TableHead className="w-24" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.map((player) => {
                  const draft = rankDrafts[player.id] ?? emptyRankDraft(player);
                  return (
                    <TableRow key={player.id}>
                      <TableCell className="font-medium">
                        {player.display_name || player.battle_tag || `#${player.id}`}
                      </TableCell>
                      {ROLES.map((role) => (
                        <TableCell key={role.code}>
                          <Input
                            value={draft[role.code] ?? ""}
                            disabled={!canEdit}
                            inputMode="numeric"
                            className="w-24"
                            aria-label={`${player.battle_tag ?? player.id} ${role.display}`}
                            onChange={(event) =>
                              setRankDrafts((current) => ({
                                ...current,
                                [player.id]: { ...draft, [role.code]: event.target.value },
                              }))
                            }
                          />
                        </TableCell>
                      ))}
                      {canEdit ? (
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saveRanks.isPending}
                            onClick={() => {
                              try {
                                saveRanks.mutate({ playerId: player.id, ranks: parseRoleRanks(draft) });
                              } catch (error) {
                                notify.apiError(error);
                              }
                            }}
                          >
                            Save
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
                {players.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 5 : 4} className="text-muted-foreground">
                      No workspace players yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Custom games</h2>
          </CardTitle>
          <CardDescription>Create a lobby, pick a roster, optionally set host ranks, then balance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (gameName.trim()) createGame.mutate();
              }}
            >
              <Input
                value={gameName}
                onChange={(event) => setGameName(event.target.value)}
                placeholder="Game name"
                className="max-w-xs"
                aria-label="Custom game name"
              />
              <Button type="submit" size="sm" disabled={createGame.isPending || !gameName.trim()}>
                Create
              </Button>
            </form>
          ) : null}

          {gamesQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border border-border/60">
              {games.map((game) => (
                <li key={game.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/40"
                    onClick={() => setSelectedGameId(game.id)}
                  >
                    <span className="font-medium">{game.name}</span>
                    <span className="text-muted-foreground">{game.status}</span>
                  </button>
                </li>
              ))}
              {games.length === 0 ? (
                <li className="px-3 py-4 text-sm text-muted-foreground">No custom games yet.</li>
              ) : null}
            </ul>
          )}

          {selectedGameId !== null ? (
            <div className="space-y-3 rounded-md border border-border/60 p-3">
              <p className="text-sm font-medium">{selectedGame?.name ?? "Game"}</p>
              {gameQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  <ul className="space-y-2">
                    {players.map((player) => {
                      const checked = rosterIds.includes(player.id);
                      const draft = hostRankDrafts[player.id] ?? emptyRankDraft();
                      return (
                        <li key={player.id} className="flex flex-wrap items-center gap-2">
                          <Checkbox
                            checked={checked}
                            disabled={!canEdit}
                            onCheckedChange={(value) =>
                              setRosterIds((current) =>
                                value === true
                                  ? [...current, player.id]
                                  : current.filter((id) => id !== player.id),
                              )
                            }
                            aria-label={`Roster ${player.battle_tag ?? player.id}`}
                          />
                          <span className="min-w-32 text-sm">
                            {player.display_name || player.battle_tag || `#${player.id}`}
                          </span>
                          {ROLES.map((role) => (
                            <Input
                              key={role.code}
                              value={draft[role.code] ?? ""}
                              disabled={!canEdit || !checked}
                              inputMode="numeric"
                              className="w-20"
                              placeholder={role.display}
                              aria-label={`Host ${role.display} ${player.battle_tag ?? player.id}`}
                              onChange={(event) =>
                                setHostRankDrafts((current) => ({
                                  ...current,
                                  [player.id]: { ...draft, [role.code]: event.target.value },
                                }))
                              }
                            />
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={saveRoster.isPending} onClick={() => saveRoster.mutate()}>
                        Save roster
                      </Button>
                      <Button size="sm" disabled={balanceGame.isPending} onClick={() => balanceGame.mutate()}>
                        Balance
                      </Button>
                    </div>
                  ) : null}
                  {selectedGame?.result_json != null ? (
                    <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs">
                      {JSON.stringify(selectedGame.result_json, null, 2)}
                    </pre>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
