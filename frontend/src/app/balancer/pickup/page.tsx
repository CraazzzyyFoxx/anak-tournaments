"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PickupMixList } from "@/app/balancer/pickup/PickupMixList";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { customGameKeys, customGameService } from "@/services/custom-game.service";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Every mix a workspace has run, newest first — the entry point for hosting
 * one. Opening or starting a mix both leave this page for
 * `/balancer/pickup/[gameId]`, which reads and edits the one already picked.
 */
export default function BalancerPickupListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();
  // The mix-hosting grant, not a tournament permission: a workspace member can
  // run a pickup game without holding admin rights over teams.
  const canEdit = workspaceId != null && canAccessPermission("custom_game.create", workspaceId);

  const gamesQuery = useQuery({
    queryKey: customGameKeys.list(workspaceId ?? 0),
    queryFn: () => customGameService.list(workspaceId as number),
    enabled: workspaceId != null,
  });

  const createGame = useMutation({
    mutationFn: (name: string) => customGameService.create(workspaceId as number, name),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: customGameKeys.list(workspaceId as number) });
      router.push(`/balancer/pickup/${created.id}`);
    },
    onError: (error) => notify.apiError(error),
  });

  if (workspaceId == null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Pick a workspace in the top bar to open mixes.
      </div>
    );
  }

  return (
    <PickupMixList
      canEdit={canEdit}
      games={gamesQuery.data ?? []}
      loading={gamesQuery.isLoading}
      error={gamesQuery.isError}
      onRetry={() => void gamesQuery.refetch()}
      creating={createGame.isPending}
      onCreateGame={(name) => createGame.mutate(name)}
    />
  );
}
