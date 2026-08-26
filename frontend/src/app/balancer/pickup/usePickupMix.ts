"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useRealtimeCoalescedRefetch } from "@/hooks/useRealtimeCoalescedRefetch";
import { notify } from "@/lib/notify";
import {
  customGameKeys,
  customGameService,
  type CustomGame,
  type CustomGameOutcome,
  type CustomGamePlayerPatch,
} from "@/services/custom-game.service";
import type { RosterSlotMap } from "@/lib/roster-shape";
import {
  workspacePlayerKeys,
  workspacePlayerService,
} from "@/services/workspace-player.service";

export type PickupPlayerPatchInput = {
  workspaceMemberId: number;
  patch: CustomGamePlayerPatch;
};

export type PickupAuthorRanksInput = {
  workspaceMemberId: number;
  /** Roles to write into this host's own book. */
  ranks: Record<string, number>;
  /** Roles to drop from it, falling back to the workspace rank. */
  clear?: string[];
};

export type PickupTeamNameInput = {
  /** 0-based, the same position `TeamColumn` renders by. */
  teamIndex: number;
  name: string;
};

export type PickupSwapSeatsInput = {
  variantIndex: number;
  firstUuid: string;
  secondUuid: string;
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

  // Another host editing this workspace's mixes (roster, ranks, bench, role
  // order) in a different tab/session: this thin, non-durable signal (see
  // `pickup_mix_realtime.py`) is the only way that becomes visible here
  // without a manual reload. Debounced like the subscriptions signal: a
  // burst of edits collapses into one refetch instead of one per event.
  useRealtimeCoalescedRefetch(`workspace:${workspaceId}:pickup_mix`, {
    minDelayMs: 500,
    onEvent: (_event, schedule) => schedule(),
    onFlush: () => {
      void queryClient.invalidateQueries({ queryKey: customGameKeys.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.all(workspaceId) });
    },
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
    onSuccess: async (game) => {
      applyGame(game);
      // Adding somebody new seeds their effective rank into this host's own
      // book (server-side `_seed_host_ranks`), so the add-players dialog's
      // "My ranks" list and chip count go stale without this.
      await queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.all(workspaceId) });
    },
    onError: (error) => notify.apiError(error),
  });

  const patchPlayer = useMutation({
    mutationFn: (input: PickupPlayerPatchInput) =>
      customGameService.updatePlayer(workspaceId, selectedGameId as number, input.workspaceMemberId, input.patch),
    onSuccess: applyGame,
    onError: (error) => notify.apiError(error),
  });

  const setTeamNames = useMutation({
    mutationFn: (input: PickupTeamNameInput) =>
      customGameService.setTeamNames(workspaceId, selectedGameId as number, {
        [String(input.teamIndex)]: input.name,
      }),
    onSuccess: applyGame,
    onError: (error) => notify.apiError(error),
  });

  const setRoleMask = useMutation({
    mutationFn: (roleMask: RosterSlotMap | null) =>
      customGameService.setRoleMask(workspaceId, selectedGameId as number, roleMask),
    onSuccess: applyGame,
    onError: (error) => notify.apiError(error),
  });

  const swapSeats = useMutation({
    mutationFn: (input: PickupSwapSeatsInput) =>
      customGameService.swapSeats(
        workspaceId,
        selectedGameId as number,
        input.variantIndex,
        input.firstUuid,
        input.secondUuid,
      ),
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

  const recordOutcome = useMutation({
    mutationFn: (outcome: CustomGameOutcome) =>
      customGameService.recordOutcome(workspaceId, selectedGameId as number, outcome),
    onSuccess: (game) => {
      applyGame(game);
      notify.success("Result saved — this mix is now closed");
    },
    onError: (error) => notify.apiError(error),
  });

  /**
   * The host's own rank book. Unlike every other write here it does not return
   * the game, so the mix detail is refetched: the book feeds rank resolution,
   * which decides the effective rank of every roster row.
   *
   * `scope: "author"` is not a parameter the caller may vary — the endpoint
   * takes no author id, so this can only ever write the caller's own book.
   */
  const setAuthorRanks = useMutation({
    mutationFn: (input: PickupAuthorRanksInput) =>
      workspacePlayerService.setRanks(workspaceId, input.workspaceMemberId, {
        scope: "author",
        ranks: input.ranks,
        clear: input.clear ?? [],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customGameKeys.all(workspaceId) });
      // The roster sidebar shows the same two layers this write changes one of.
      await queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.all(workspaceId) });
    },
    onError: (error) => notify.apiError(error),
  });

  return {
    selectedGameId,
    gamesQuery,
    gameQuery,
    createGame,
    setRoster,
    patchPlayer,
    balance,
    recordOutcome,
    setAuthorRanks,
    setTeamNames,
    setRoleMask,
    swapSeats,
  };
}
