"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { notify } from "@/lib/notify";
import {
  customGameKeys,
  customGameService,
  type CustomGame,
  type CustomGamePlayerPatch,
} from "@/services/custom-game.service";

export type PickupPlayerPatchInput = {
  workspacePlayerId: number;
  patch: CustomGamePlayerPatch;
};

/**
 * Every read and write for one workspace's mixes, in one place.
 *
 * The mix detail query is the single source of truth for the lineup — every
 * write returns the whole game, so the cache is seeded from the response
 * instead of a refetch, and no panel keeps a private copy of the roster.
 *
 * `pickedGameId` is what the host explicitly chose. The resolved
 * `selectedGameId` is derived rather than synced through an effect: an explicit
 * pick wins while that mix still exists, otherwise the newest mix (the list is
 * id-descending) is shown, which is also how the view recovers when another
 * host cancels the mix being watched.
 */
export function usePickupMix(workspaceId: number, pickedGameId: number | null) {
  const queryClient = useQueryClient();

  const gamesQuery = useQuery({
    queryKey: customGameKeys.list(workspaceId),
    queryFn: () => customGameService.list(workspaceId),
  });

  const games = gamesQuery.data ?? [];
  const selectedGameId =
    pickedGameId != null && games.some((item) => item.id === pickedGameId)
      ? pickedGameId
      : (games[0]?.id ?? null);

  const gameQuery = useQuery({
    queryKey: customGameKeys.one(workspaceId, selectedGameId ?? 0),
    queryFn: () => customGameService.get(workspaceId, selectedGameId as number),
    enabled: selectedGameId != null,
  });

  const applyGame = (game: CustomGame) => {
    queryClient.setQueryData(customGameKeys.one(workspaceId, game.id), game);
    // The list carries name and status, both of which a write can change.
    void queryClient.invalidateQueries({ queryKey: customGameKeys.list(workspaceId) });
  };

  const createGame = useMutation({
    mutationFn: (name: string) => customGameService.create(workspaceId, name),
    onSuccess: applyGame,
    onError: (error) => notify.apiError(error),
  });

  const setRoster = useMutation({
    mutationFn: (playerIds: number[]) =>
      customGameService.updateRoster(workspaceId, selectedGameId as number, playerIds),
    onSuccess: applyGame,
    onError: (error) => notify.apiError(error),
  });

  const patchPlayer = useMutation({
    mutationFn: (input: PickupPlayerPatchInput) =>
      customGameService.updatePlayer(workspaceId, selectedGameId as number, input.workspacePlayerId, input.patch),
    onSuccess: applyGame,
    onError: (error) => notify.apiError(error),
  });

  const balance = useMutation({
    mutationFn: () => customGameService.balance(workspaceId, selectedGameId as number),
    onSuccess: (game) => {
      applyGame(game);
      notify.success("Teams balanced");
    },
    onError: (error) => notify.apiError(error),
  });

  return { selectedGameId, gamesQuery, gameQuery, createGame, setRoster, patchPlayer, balance };
}
