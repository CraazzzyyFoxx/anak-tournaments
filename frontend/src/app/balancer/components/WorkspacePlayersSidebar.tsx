"use client";

import { memo, useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Circle,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { DivisionRankPicker } from "@/app/balancer/components/DivisionRankPicker";
import {
  ICON_BUTTON_CLASS,
  PANEL_CLASS,
  ROLE_TEXT_ACCENTS,
  splitBattleTag,
} from "@/app/balancer/components/balancer-page-helpers";
import {
  BattleTagContextMenuItems,
  BattleTagCopyButton,
} from "@/app/balancer/components/BattleTagCopyControls";
import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { DataPagination } from "@/components/ui/data-pagination";
import { Input } from "@/components/ui/input";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/notify";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { resolveDivisionFromRank } from "@/lib/division-grid";
import { ROLE_LABELS, ROLES, type RoleCode } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  workspacePlayerKeys,
  workspacePlayerService,
  type WorkspacePlayer,
} from "@/services/workspace-player.service";

const PER_PAGE = 30;

/** Matches the three `size-8` rank pickers a row ends with, so the legend sits over its column. */
const RANK_COLUMN_CLASS = "flex size-8 shrink-0 items-center justify-center";

type WorkspacePlayersSidebarProps = {
  workspaceId: number;
  canEdit: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  selectedIds?: number[];
  onTogglePlayer?: (player: WorkspacePlayer) => void;
};

function playerLabel(player: WorkspacePlayer): string {
  return player.display_name || player.battle_tag || `#${player.id}`;
}

/** `1–30 of 224`, using the real page length so the last page is not overstated. */
function rangeSummary(page: number, perPage: number, shown: number, total: number): string {
  const first = (page - 1) * perPage + 1;
  return `${first}\u2013${first + shown - 1} of ${total}`;
}

type WorkspacePlayerRowProps = {
  player: WorkspacePlayer;
  canEdit: boolean;
  isSelected: boolean;
  isSaving: boolean;
  onToggle?: (player: WorkspacePlayer) => void;
  onSaveRanks: (ranks: Record<string, number>) => void;
};

/**
 * The tournament pool row, simplified.
 *
 * Same anatomy as `PoolPlayerCompactList`'s row — leading selection dot, the
 * ranked-role glyphs beside the name, the division icon and accent-coloured top
 * rank on the right, a BattleTag copy button, and a right-click menu — minus
 * everything that only exists for a tournament registration: the balancer status
 * menu, the pool include/exclude button, and the Flex / Ready / issue chips. A
 * workspace player has no registration to carry a status, and no pool to be
 * excluded from; what it does have, and the pool row does not, is directly
 * editable canon ranks, which is why the three pickers stay on the second line.
 *
 * Memoized for the same reason the pool row is: each row mounts a Radix context
 * menu root, and the search field is deferred, so an unmemoized list re-rendered
 * every row on every keystroke.
 */
const WorkspacePlayerRow = memo(function WorkspacePlayerRow({
  player,
  canEdit,
  isSelected,
  isSaving,
  onToggle,
  onSaveRanks,
}: WorkspacePlayerRowProps) {
  const grid = useDivisionGrid();
  const label = playerLabel(player);
  const { name, suffix } = splitBattleTag(label);
  const rankedRoles = ROLES.filter((role) => typeof player.ranks[role.code] === "number");
  // The strongest role is what a pool decision is made on, and the glyph alone
  // hides the value — same reasoning as the pool row's primary entry.
  const topRank = rankedRoles.reduce<{ role: RoleCode; rank: number } | null>((best, role) => {
    const rank = player.ranks[role.code] as number;
    return best && best.rank >= rank ? best : { role: role.code, rank };
  }, null);
  const division = topRank ? resolveDivisionFromRank(grid, topRank.rank) : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          className={cn(
            "group grid w-full grid-cols-[24px_minmax(0,1fr)] items-start gap-2 rounded-xl border px-2.5 py-2 transition-colors",
            "border-[color:var(--aqt-border)] bg-white/[0.02]",
            "hover:border-[color:var(--aqt-border-2)] hover:bg-white/[0.04]",
            isSelected && "border-primary/45 bg-primary/[0.08]",
          )}
        >
          {onToggle ? (
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={isSelected ? `Remove ${label} from the lineup` : `Add ${label} to the lineup`}
              onClick={() => onToggle(player)}
              className={cn(
                "mt-0.5 flex size-6 items-center justify-center rounded-md border transition-colors",
                isSelected
                  ? "border-primary/50 bg-primary/20 text-[color:var(--aqt-fg)]"
                  : "border-[color:var(--aqt-border-2)] bg-black/15 text-[color:var(--aqt-fg-dim)] hover:text-[color:var(--aqt-fg-muted)]",
              )}
            >
              {isSelected ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <Circle className="size-2.5 fill-current stroke-none" aria-hidden="true" />
              )}
            </button>
          ) : (
            <span aria-hidden="true" />
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {rankedRoles.length > 0 ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {rankedRoles.map((role) => (
                      <span key={role.code} title={ROLE_LABELS[role.code]}>
                        <PlayerRoleIcon role={role.icon} size={15} label={ROLE_LABELS[role.code]} />
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="shrink-0 text-[11px] text-[color:var(--aqt-fg-dim)]">No roles</span>
                )}
                {/* One truncating line, not a flex pair: with the discriminator as
                    its own `shrink-0` item, a narrow sidebar clipped the whole name
                    away and left a row identified only by `#1111`. */}
                <span
                  title={label}
                  className="min-w-0 truncate text-[13px] font-medium text-[color:var(--aqt-fg)]"
                >
                  {name}
                  {suffix ? <span className="text-[color:var(--aqt-fg-dim)]">{suffix}</span> : null}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {division == null ? null : (
                  <span title={`Division ${division}`}>
                    <DivisionIcon division={division} width={20} height={20} />
                  </span>
                )}
                {topRank ? (
                  <span
                    title={`Highest rank: ${ROLE_LABELS[topRank.role]} ${topRank.rank}`}
                    className={cn(
                      "min-w-10 text-right text-[13px] font-semibold tabular-nums",
                      ROLE_TEXT_ACCENTS[topRank.role],
                    )}
                  >
                    {topRank.rank}
                  </span>
                ) : (
                  <span className="text-[12px] text-[color:var(--aqt-fg-dim)]">No ranks yet</span>
                )}
                {player.battle_tag ? <BattleTagCopyButton battleTag={player.battle_tag} /> : null}
              </div>
            </div>

            <div
              role="group"
              aria-label={`Ranks for ${label}`}
              className="mt-1.5 flex items-center justify-end gap-1.5"
            >
              {ROLES.map((role) => (
                <DivisionRankPicker
                  key={role.code}
                  rank={player.ranks[role.code] ?? null}
                  disabled={!canEdit || isSaving}
                  label={`${ROLE_LABELS[role.code]} rank for ${label}`}
                  onChange={(nextRank) => {
                    const ranks = { ...player.ranks };
                    if (nextRank == null) delete ranks[role.code];
                    else ranks[role.code] = nextRank;
                    onSaveRanks(ranks);
                  }}
                />
              ))}
            </div>
          </div>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>Player actions</ContextMenuLabel>
        {onToggle ? (
          <ContextMenuItem onClick={() => onToggle(player)}>
            <Check className="h-4 w-4" />
            {isSelected ? "Remove from the lineup" : "Add to the lineup"}
          </ContextMenuItem>
        ) : null}
        {player.battle_tag ? <BattleTagContextMenuItems battleTags={[player.battle_tag]} /> : null}
      </ContextMenuContent>
    </ContextMenu>
  );
});

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
  const [addError, setAddError] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const deferredSearch = useDeferredValue(search.trim());
  const searchRef = useRef<HTMLInputElement>(null);
  const battleTagRef = useRef<HTMLInputElement>(null);
  const battleTagId = useId();
  const battleTagHintId = `${battleTagId}-hint`;
  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);

  const listParams = { page, perPage: PER_PAGE, query: deferredSearch };
  const playersQuery = useQuery({
    queryKey: workspacePlayerKeys.list(workspaceId, listParams),
    queryFn: () => workspacePlayerService.list(workspaceId, listParams),
    // Every keystroke and page click is a new key: without this the rows are
    // replaced by skeletons mid-typing and the panel flickers per character.
    placeholderData: keepPreviousData,
  });

  const addPlayer = useMutation({
    mutationFn: (tag: string) => workspacePlayerService.upsert(workspaceId, tag),
    onSuccess: async (_player, tag) => {
      setBattleTag("");
      setIsAddOpen(false);
      notify.success(`${tag} saved to the workspace`);
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

  const pageData = playersQuery.data;
  const total = pageData?.total ?? null;
  const players = pageData?.results ?? [];
  const totalPages = pageData ? Math.max(1, Math.ceil(pageData.total / pageData.per_page)) : 1;

  if (collapsed) {
    return (
      <div className={cn(PANEL_CLASS, "flex min-h-0 min-w-0 flex-col items-center gap-3 p-2")}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(ICON_BUTTON_CLASS, "h-9 w-9 rounded-xl")}
          onClick={onToggleCollapsed}
        >
          <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Expand workspace players sidebar</span>
        </Button>
        <div className="flex flex-1 flex-col items-center gap-2 pt-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--aqt-border)] bg-black/15 text-[color:var(--aqt-fg-muted)]">
            <Users className="h-4 w-4" aria-hidden="true" />
          </div>
          <div
            aria-hidden="true"
            className="text-center text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)] [writing-mode:vertical-rl]"
          >
            Players
          </div>
        </div>
        {/* `?? 0` used to claim an empty workspace for as long as the first page
            was in flight, and a bare dash announces as "em dash". */}
        {total == null ? (
          <Skeleton className="h-6 w-8 rounded-lg" />
        ) : (
          <div
            title={`${total} workspace players`}
            className="rounded-lg border border-[color:var(--aqt-border)] bg-black/15 px-2 py-1 text-[11px] tabular-nums text-[color:var(--aqt-fg-muted)]"
          >
            {total}
            <span className="sr-only"> workspace players</span>
          </div>
        )}
      </div>
    );
  }

  const submitBattleTag = () => {
    const tag = battleTag.trim();
    if (!tag) {
      setAddError("Enter a BattleTag, for example Name#1234.");
      battleTagRef.current?.focus();
      return;
    }
    setAddError(null);
    addPlayer.mutate(tag);
  };

  const clearSearch = () => {
    setSearch("");
    setPage(1);
    searchRef.current?.focus();
  };

  const listStatus =
    playersQuery.isLoading || total == null
      ? ""
      : total === 0
        ? "No workspace players shown"
        : `${rangeSummary(page, PER_PAGE, players.length, total)} workspace players shown`;

  return (
    // `min-w-0`: as a grid item this panel inherits `min-width: auto`, so below
    // roughly 300px it overflowed its own track instead of truncating rows.
    <div className={cn(PANEL_CLASS, "flex min-h-0 min-w-0 flex-col p-4")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {/* Short enough to hold one line at the narrowest sidebar width; the
              workspace is already the tool's context, and the rail says the same. */}
          <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]">
            Players
          </div>
          <div className="mt-1 text-sm tabular-nums text-[color:var(--aqt-fg-muted)]">
            {total == null ? "Loading\u2026" : `${total} ${total === 1 ? "player" : "players"}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Secondary: adding a tag is rare next to reading and ranking the roster,
              so it lives behind an icon instead of a permanent three-row form. */}
          {canEdit ? (
            <Popover
              open={isAddOpen}
              onOpenChange={(open) => {
                setIsAddOpen(open);
                if (!open) setAddError(null);
              }}
            >
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON_CLASS}>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Add a workspace player</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <form
                  className="space-y-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitBattleTag();
                  }}
                >
                  <label
                    htmlFor={battleTagId}
                    className="block text-[11px] uppercase tracking-[0.14em] text-[color:var(--aqt-fg-dim)]"
                  >
                    Add by BattleTag
                  </label>
                  <div className="flex gap-1.5">
                    <Input
                      ref={battleTagRef}
                      id={battleTagId}
                      value={battleTag}
                      onChange={(event) => {
                        setBattleTag(event.target.value);
                        if (addError) setAddError(null);
                      }}
                      placeholder="Name#1234"
                      autoComplete="off"
                      aria-invalid={addError ? true : undefined}
                      aria-describedby={battleTagHintId}
                      // `min-w-0`: an `<input>` carries an intrinsic ~170px width that
                      // `min-width: auto` in a flex row turns into a floor.
                      className="h-9 min-w-0 rounded-lg border-[color:var(--aqt-border-2)] bg-black/15 text-sm"
                    />
                    {/* Enabled while empty on purpose: submit validates and points at the field. */}
                    <Button
                      type="submit"
                      size="sm"
                      className="h-9 shrink-0 px-3"
                      disabled={addPlayer.isPending}
                    >
                      {addPlayer.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : null}
                      Add player
                    </Button>
                  </div>
                  <p
                    id={battleTagHintId}
                    className={cn(
                      "text-[11px]",
                      addError ? "text-rose-200" : "text-[color:var(--aqt-fg-dim)]",
                    )}
                  >
                    {addError ?? "Ranks here carry across every tournament in this workspace."}
                  </p>
                </form>
              </PopoverContent>
            </Popover>
          ) : null}
          {onToggleCollapsed ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ICON_BUTTON_CLASS}
              onClick={onToggleCollapsed}
            >
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Collapse workspace players sidebar</span>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--aqt-fg-dim)]"
          aria-hidden="true"
        />
        <Input
          ref={searchRef}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search name or BattleTag"
          aria-label="Search workspace players"
          autoComplete="off"
          className={cn(
            "h-9 rounded-lg border-[color:var(--aqt-border-2)] bg-black/15 pl-9 text-sm",
            search && "pr-9",
          )}
        />
        {search ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg text-[color:var(--aqt-fg-dim)] hover:bg-white/5 hover:text-[color:var(--aqt-fg)]"
            onClick={clearSearch}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Clear the player search</span>
          </Button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {listStatus}
      </p>

      {/* `keepPreviousData` keeps the last page on screen when the next one fails.
          Without this strip the panel would silently answer a new query with the
          old rows. */}
      {playersQuery.isError && pageData ? (
        <div
          role="alert"
          className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-100"
        >
          <span className="min-w-0">Couldn&rsquo;t refresh &mdash; showing the last loaded page.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 rounded border border-rose-300/30 px-1.5 text-[11px] text-rose-100 hover:bg-rose-500/15 hover:text-rose-50"
            onClick={() => void playersQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {/* Same box model as a row — the scroller's `pr-2`, the row's transparent
          border and its `24px` selection column are what put each glyph exactly
          over its picker below. */}
      <div className="mt-3 pr-2">
        <div className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border border-transparent px-2.5 pb-1.5">
          <span aria-hidden="true" />
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-[0.14em] text-[color:var(--aqt-fg-dim)]">
              Player
            </span>
            {/* Decorative: every picker below already announces its own role and player. */}
            <div className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
              {ROLES.map((role) => (
                <span key={role.code} className={RANK_COLUMN_CLASS} title={ROLE_LABELS[role.code]}>
                  <PlayerRoleIcon role={role.icon} size={14} decorative />
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Below `xl` the balancer shell drops its fixed height, so an uncapped scroller
          would grow to its content and push a scrollbar onto the document. */}
      <div className="min-h-0 max-h-[calc(100svh-16rem)] flex-1 overflow-y-auto overflow-x-hidden pr-2">
        {playersQuery.isLoading ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <Skeleton key={row} className="h-11 w-full rounded-xl" />
            ))}
          </div>
        ) : playersQuery.isError && !pageData ? (
          <PageStateCard
            state="error"
            title="Unable to load workspace players"
            description="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => void playersQuery.refetch()}
            className="px-4 py-8"
          />
        ) : players.length === 0 ? (
          deferredSearch ? (
            <PageStateCard
              state="filtered-empty"
              title={`No players match \u201C${deferredSearch}\u201D`}
              description="Try a different name or BattleTag."
              actionLabel="Clear search"
              onAction={clearSearch}
              className="px-4 py-8"
            />
          ) : (
            <PageStateCard
              state="empty"
              title="No workspace players yet"
              description={
                canEdit
                  ? "Add a BattleTag above to start the roster this workspace balances from."
                  : "Players added to this workspace will appear here."
              }
              className="px-4 py-8"
            />
          )
        ) : (
          <ul className="space-y-1.5" aria-label="Workspace players">
            {players.map((player) => (
              <WorkspacePlayerRow
                key={player.id}
                player={player}
                canEdit={canEdit}
                isSelected={selected.has(player.id)}
                // Scoped to the row being written: one save used to disable every
                // picker in the list, so the whole panel greyed out per keystroke.
                isSaving={saveRanks.isPending && saveRanks.variables?.playerId === player.id}
                onToggle={onTogglePlayer}
                onSaveRanks={(ranks) => saveRanks.mutate({ playerId: player.id, ranks })}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 border-t border-[color:var(--aqt-border)] pt-2">
        <DataPagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={
            pageData
              ? pageData.total === 0
                ? "0 players"
                : rangeSummary(page, pageData.per_page, players.length, pageData.total)
              : undefined
          }
        />
      </div>
    </div>
  );
}
