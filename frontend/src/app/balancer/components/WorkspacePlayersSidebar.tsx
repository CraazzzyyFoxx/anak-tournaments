"use client";

import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PanelRightClose, PanelRightOpen, Search, Users } from "lucide-react";

import { DivisionRankPicker } from "@/app/balancer/components/DivisionRankPicker";
import { PANEL_CLASS } from "@/app/balancer/components/balancer-page-helpers";
import { Button } from "@/components/ui/button";
import { DataPagination } from "@/components/ui/data-pagination";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/notify";
import { ROLE_LABELS, ROLES } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  workspacePlayerKeys,
  workspacePlayerService,
  type WorkspacePlayer,
} from "@/services/workspace-player.service";

const ICON_BUTTON_CLASS =
  "h-8 w-8 rounded-lg border border-[color:var(--aqt-border)] bg-black/15 text-[color:var(--aqt-fg-muted)] hover:bg-white/5 hover:text-[color:var(--aqt-fg)]";

const PER_PAGE = 30;

type WorkspacePlayersSidebarProps = {
  workspaceId: number;
  canEdit: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  selectedIds?: number[];
  onTogglePlayer?: (player: WorkspacePlayer) => void;
};

export function WorkspacePlayersSidebar({
  workspaceId,
  canEdit,
  collapsed = false,
  onToggleCollapsed,
  selectedIds,
  onTogglePlayer,
}: Readonly<WorkspacePlayersSidebarProps>) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [battleTag, setBattleTag] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const selected = new Set(selectedIds ?? []);

  const listParams = { page, perPage: PER_PAGE, query: deferredSearch };
  const playersQuery = useQuery({
    queryKey: workspacePlayerKeys.list(workspaceId, listParams),
    queryFn: () => workspacePlayerService.list(workspaceId, listParams),
  });

  const addPlayer = useMutation({
    mutationFn: () => workspacePlayerService.upsert(workspaceId, battleTag.trim()),
    onSuccess: async () => {
      setBattleTag("");
      await queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.all(workspaceId) });
    },
    onError: (error) => notify.apiError(error),
  });

  const saveRanks = useMutation({
    mutationFn: ({ playerId, ranks }: { playerId: number; ranks: Record<string, number> }) =>
      workspacePlayerService.setRanks(workspaceId, playerId, ranks),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.all(workspaceId) });
    },
    onError: (error) => notify.apiError(error),
  });

  if (collapsed) {
    return (
      <div className={cn(PANEL_CLASS, "flex min-h-0 flex-col items-center gap-3 p-2")}>
        <Button type="button" variant="ghost" size="icon" className={cn(ICON_BUTTON_CLASS, "h-9 w-9 rounded-xl")} onClick={onToggleCollapsed}>
          <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Expand workspace players sidebar</span>
        </Button>
        <div className="flex flex-1 flex-col items-center gap-2 pt-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--aqt-border)] bg-black/15 text-[color:var(--aqt-fg-muted)]">
            <Users className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="text-center text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)] [writing-mode:vertical-rl]">
            Players
          </div>
        </div>
        <div className="rounded-lg border border-[color:var(--aqt-border)] bg-black/15 px-2 py-1 text-[11px] tabular-nums text-[color:var(--aqt-fg-muted)]">
          {playersQuery.data?.total ?? 0}
        </div>
      </div>
    );
  }

  const pageData = playersQuery.data;
  const totalPages = pageData ? Math.max(1, Math.ceil(pageData.total / pageData.per_page)) : 1;

  return (
    <div className={cn(PANEL_CLASS, "flex min-h-0 flex-col")}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">Workspace players</p>
        {onToggleCollapsed ? (
          <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON_CLASS} onClick={onToggleCollapsed}>
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Collapse workspace players sidebar</span>
          </Button>
        ) : null}
      </div>

      <div className="space-y-2 border-b border-border/60 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search battle tag"
            className="h-8 pl-7"
            aria-label="Search workspace players"
          />
        </div>
        {canEdit ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (battleTag.trim()) addPlayer.mutate();
            }}
          >
            <Input
              value={battleTag}
              onChange={(event) => setBattleTag(event.target.value)}
              placeholder="Name#1234"
              className="h-8"
              aria-label="Battle tag"
            />
            <Button type="submit" size="sm" className="h-8 shrink-0" disabled={addPlayer.isPending || !battleTag.trim()}>
              Add
            </Button>
          </form>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {playersQuery.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <ul>
            {(pageData?.results ?? []).map((player) => {
              const selectedRow = selected.has(player.id);
              return (
                <li
                  key={player.id}
                  className={cn(
                    "flex items-center gap-2 border-b border-border/40 px-3 py-2 last:border-b-0",
                    selectedRow && "bg-white/[0.04]",
                  )}
                >
                  {onTogglePlayer ? (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-foreground"
                      onClick={() => onTogglePlayer(player)}
                    >
                      {player.display_name || player.battle_tag || `#${player.id}`}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {player.display_name || player.battle_tag || `#${player.id}`}
                    </span>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    {ROLES.map((role) => (
                      <DivisionRankPicker
                        key={role.code}
                        rank={player.ranks[role.code] ?? null}
                        disabled={!canEdit || saveRanks.isPending}
                        label={`${ROLE_LABELS[role.code]} ${player.battle_tag ?? player.id}`}
                        onChange={(nextRank) => {
                          const ranks = { ...player.ranks };
                          if (nextRank == null) delete ranks[role.code];
                          else ranks[role.code] = nextRank;
                          saveRanks.mutate({ playerId: player.id, ranks });
                        }}
                      />
                    ))}
                  </div>
                </li>
              );
            })}
            {pageData?.results.length === 0 ? (
              <li className="px-3 py-6 text-sm text-muted-foreground">No workspace players yet.</li>
            ) : null}
          </ul>
        )}
      </div>

      <div className="border-t border-border/60 px-2 py-2">
        <DataPagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={pageData ? `${pageData.total} players` : undefined}
        />
      </div>
    </div>
  );
}
