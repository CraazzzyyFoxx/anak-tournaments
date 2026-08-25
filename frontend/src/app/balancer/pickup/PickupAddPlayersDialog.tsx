"use client";

import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CornerDownLeft, Loader2, Plus, Search, UserPlus, X } from "lucide-react";

import { DivisionRankPicker } from "@/app/balancer/components/DivisionRankPicker";
import { splitBattleTag } from "@/app/balancer/components/balancer-page-helpers";
import {
  CAPTION_CLASS,
  CARD_TITLE_CLASS,
  EYEBROW_CLASS,
  ROLE_TILE_CLASS,
} from "@/app/balancer/pickup/pickup-chrome";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { DataPagination } from "@/components/ui/data-pagination";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { OW_REFERENCE_GRID } from "@/lib/division-grid";
import { notify } from "@/lib/notify";
import { ROLES, ROLE_LABELS, type RoleCode } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  customGameKeys,
  type CustomGamePlayer,
} from "@/services/custom-game.service";
import {
  workspacePlayerKeys,
  workspacePlayerService,
  type RosterMember,
} from "@/services/workspace-player.service";

import {
  LOBBY_SIZE,
  averageRank,
  playerLabel,
  resolveRoleOrder,
  sortLineup,
  summarizeLineup,
  summarizeRoleSupply,
} from "./pickup-lineup";

/** Dense enough that a 900px-tall dialog shows a full page without scrolling twice. */
const PER_PAGE = 24;

/**
 * One workspace roster row, normalised for display: `ranks` is what a balance
 * would actually use (canon overridden by this host's own book, the same
 * precedence the balancer applies), `authorRanks` is that book alone so a
 * picker can tell "mine" from "inherited".
 */
type RosterRow = {
  memberId: number;
  battleTag: string | null;
  displayName: string | null;
  ranks: Record<string, number>;
  authorRanks: Record<string, number>;
};

type PickupAddPlayersDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  /** Workspace right: whether a new BattleTag can be added to the roster. */
  canEdit: boolean;
  /**
   * Whether the rank pickers write. Only the host's book decides this mix, and
   * the endpoint writes the caller's own, so anyone else editing here produced a
   * 200 that changed nothing on screen.
   */
  canEditRanks: boolean;
  /** Mix right: whether membership can change at all (a closed mix is read-only). */
  canWrite: boolean;
  /** Whose rank book this mix resolves against, so the list shows the numbers it will use. */
  hostUserId: number | null;
  /** The mix lineup, so the right column can show supply without a second query. */
  rows: CustomGamePlayer[];
  onTogglePlayer: (memberId: number) => void;
};

/**
 * Filling a mix, as one screen instead of two.
 *
 * The roster used to open as a single-column overlay that reused the tournament
 * balancer's sidebar, which meant a host adding twelve people had to close it to
 * check what they had built, reopen it to fix the tank shortage, and close it
 * again. The lineup is now the right half of the same dialog: every click on the
 * left updates the seat count, the role gauges and the list on the right, so
 * "have I got a lobby" is answered without leaving the surface that answers it.
 *
 * It is deliberately NOT the tournament sidebar any more. That panel is a
 * roster editor for a workspace — collapsible, rank-layer-aware, at home in a
 * 320px rail. This is a picker for one mix, and the two had already started
 * paying for each other's constraints.
 *
 * The ranks it shows and edits are the *host's* book (`scope: "author"`), the
 * layer that decides this mix — read via `authorUserId` rather than defaulting
 * to the caller's, which is what used to make a co-organiser's list disagree
 * with the lineup beside it. The workspace canon shows through dimmed where the
 * host has not set their own.
 */
export function PickupAddPlayersDialog({
  open,
  onOpenChange,
  workspaceId,
  canEdit,
  canEditRanks,
  canWrite,
  hostUserId,
  rows,
  onTogglePlayer,
}: Readonly<PickupAddPlayersDialogProps>) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [cursor, setCursor] = useState(0);
  const [cursorKey, setCursorKey] = useState("all|1|");
  const [battleTag, setBattleTag] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const deferredSearch = useDeferredValue(search.trim());

  const usingMine = filter === "mine";
  const listParams = {
    page,
    perPage: PER_PAGE,
    query: deferredSearch,
    authorUserId: hostUserId ?? undefined,
    authorOnly: usingMine,
  };
  const rosterQuery = useQuery({
    queryKey: workspacePlayerKeys.list(workspaceId, listParams),
    queryFn: () => workspacePlayerService.list(workspaceId, listParams),
    enabled: open,
    // Every keystroke and page click is a new key: without this the rows are
    // replaced by skeletons mid-typing and the whole column flickers per
    // character.
    placeholderData: keepPreviousData,
  });

  // The workspace's total member count, independent of which filter is
  // active: `rosterQuery`'s total means "matches under the current filter",
  // the wrong number for the header and the "Everyone" chip once "My ranks"
  // has narrowed it.
  const workspaceCountQuery = useQuery({
    queryKey: workspacePlayerKeys.list(workspaceId, { page: 1, perPage: 1, query: "" }),
    queryFn: () => workspacePlayerService.list(workspaceId, { page: 1, perPage: 1 }),
    enabled: open,
  });

  /**
   * One role per write, so saving Tank never rewrites Damage: the endpoint
   * leaves an omitted role alone, and `clear` deletes the role from the layer
   * instead of pinning a zero over the value it should fall back to.
   */
  const saveRank = useMutation({
    mutationFn: ({
      memberId,
      role,
      rank,
    }: {
      memberId: number;
      role: string;
      rank: number | null;
    }) =>
      workspacePlayerService.setRanks(workspaceId, memberId, {
        scope: "author",
        ranks: rank == null ? {} : { [role]: rank },
        clear: rank == null ? [role] : [],
      }),
    onSuccess: async () => {
      // Both caches: the roster shows the layer that was written, and the mix
      // shows the effective rank that just changed under it.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.all(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: customGameKeys.all(workspaceId) }),
      ]);
    },
    onError: (error) => notify.apiError(error),
  });

  const addByTag = useMutation({
    mutationFn: (tag: string) => workspacePlayerService.upsert(workspaceId, tag),
    onSuccess: async (member, tag) => {
      setBattleTag("");
      setIsAddOpen(false);
      notify.success(`${tag} joined the workspace roster`);
      await queryClient.invalidateQueries({ queryKey: workspacePlayerKeys.all(workspaceId) });
      // Straight into the mix: a host types a tag *because* that person is in the
      // lobby right now, so making them find the new row afterwards was busywork.
      if (canWrite) onTogglePlayer(member.member_id);
    },
    onError: (error) => notify.apiError(error),
  });

  const pageData = rosterQuery.data;
  const workspaceTotal = workspaceCountQuery.data?.total ?? null;

  const visible = useMemo<RosterRow[]>(
    () =>
      (pageData?.results ?? []).map((member: RosterMember) => ({
        memberId: member.member_id,
        battleTag: member.battle_tag,
        displayName: member.display_name,
        // Effective = canon overridden by this host's own book, the same
        // precedence the balancer applies.
        ranks: { ...member.ranks, ...member.author_ranks },
        authorRanks: member.author_ranks,
      })),
    [pageData],
  );

  const inMix = useMemo(() => new Set(rows.map((row) => row.workspace_member_id)), [rows]);

  const summary = summarizeLineup(rows);
  const supply = summarizeRoleSupply(rows);
  const overflow = summary.active - LOBBY_SIZE;
  const totalPages = pageData ? Math.max(1, Math.ceil(pageData.total / pageData.per_page)) : 1;
  const foundCount = pageData?.total ?? null;

  // A new result set invalidates the cursor: leaving it at row 9 of a list that is
  // now three long would put the Enter key on nothing. Adjusted during render
  // rather than in an effect — the cursor is derived from the query, so a
  // cascading second render is exactly what must not happen between the list
  // changing and the highlight moving.
  const resultKey = `${filter}|${page}|${deferredSearch}`;
  if (cursorKey !== resultKey) {
    setCursorKey(resultKey);
    setCursor(0);
  }

  const move = useCallback(
    (delta: 1 | -1) => {
      setCursor((current) => {
        const next = Math.min(Math.max(current + delta, 0), Math.max(visible.length - 1, 0));
        listRef.current
          ?.querySelectorAll("[data-roster-row]")
          [next]?.scrollIntoView({ block: "nearest" });
        return next;
      });
    },
    [visible.length],
  );

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = visible[cursor];
      if (row != null && canWrite) onTogglePlayer(row.memberId);
    }
  };

  const submitBattleTag = () => {
    const tag = battleTag.trim();
    if (!tag) {
      setAddError("Enter a BattleTag, for example Name#1234.");
      return;
    }
    setAddError(null);
    addByTag.mutate(tag);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // A working surface, not a prompt: the roster needs three rank columns
        // and the lineup beside it, and at `sm:max-w-lg` the pickers wrapped
        // onto a second line for every single row.
        className="flex h-[min(58rem,calc(100svh-3rem))] w-[min(74rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        {/* The tool's hero motif, one hairline of it: this dialog is the only
            full-bleed surface in the mix flow, and without a lit top edge it read
            as a grey sheet dropped over a grey page. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-[color:var(--aqt-teal)]"
        />
        <header className="flex shrink-0 items-baseline gap-3 border-b border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)] px-5 py-3.5 pr-12">
          <DialogTitle className={cn(CARD_TITLE_CLASS, "tracking-[0.08em]")}>
            Add players
          </DialogTitle>
          <DialogDescription className={cn(CAPTION_CLASS, "min-w-0 truncate")}>
            {workspaceTotal == null
              ? "Loading the workspace roster\u2026"
              : `${workspaceTotal} in this workspace \u00B7 ${
                  canEditRanks ? "your ranks decide" : "the host's ranks decide"
                }, workspace ranks fill the gaps`}
          </DialogDescription>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-1">
          {/* ── The roster ───────────────────────────────────────────────── */}
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="shrink-0 space-y-2.5 px-4 pb-3 pt-3.5">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[color:var(--aqt-fg-dim)]"
                  aria-hidden="true"
                />
                <Input
                  autoFocus
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  onKeyDown={onSearchKeyDown}
                  placeholder={"Type a name or BattleTag \u2014 \u2191\u2193 to move, Enter to add"}
                  aria-label="Search the workspace roster"
                  autoComplete="off"
                  className="h-11 rounded-xl border-[color:var(--aqt-border-2)] bg-black/25 pl-10 pr-24 text-sm"
                />
                <span
                  className={cn(
                    EYEBROW_CLASS,
                    "pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 tabular-nums",
                  )}
                >
                  {foundCount == null ? "" : `${foundCount} found`}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip
                  label="Everyone"
                  count={workspaceTotal}
                  active={!usingMine}
                  onClick={() => {
                    setFilter("all");
                    setPage(1);
                  }}
                />
                <FilterChip
                  label="My ranks"
                  count={usingMine ? foundCount : null}
                  active={usingMine}
                  onClick={() => {
                    setFilter("mine");
                    setPage(1);
                  }}
                />
                {canEdit ? (
                  <Popover
                    open={isAddOpen}
                    onOpenChange={(next) => {
                      setIsAddOpen(next);
                      if (!next) setAddError(null);
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed px-3",
                          "border-[color:var(--aqt-border-2)] text-[12px] text-[color:var(--aqt-fg-dim)]",
                          "transition-colors hover:border-[color:var(--aqt-border-3)] hover:text-[color:var(--aqt-fg)]",
                        )}
                      >
                        <UserPlus className="size-3.5" aria-hidden="true" />
                        New BattleTag
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 p-3">
                      <form
                        className="space-y-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitBattleTag();
                        }}
                      >
                        <p className={EYEBROW_CLASS}>Add someone new</p>
                        <div className="flex gap-1.5">
                          <Input
                            value={battleTag}
                            onChange={(event) => {
                              setBattleTag(event.target.value);
                              if (addError) setAddError(null);
                            }}
                            placeholder="Name#1234"
                            aria-label="New BattleTag"
                            autoComplete="off"
                            aria-invalid={addError ? true : undefined}
                            // `min-w-0`: an `<input>` carries an intrinsic ~170px
                            // width that `min-width: auto` turns into a floor.
                            className="h-9 min-w-0 rounded-lg border-[color:var(--aqt-border-2)] bg-black/20 text-sm"
                          />
                          {/* Enabled while empty on purpose: submit validates and says why. */}
                          <Button
                            type="submit"
                            size="sm"
                            className="h-9 shrink-0 px-3"
                            disabled={addByTag.isPending}
                          >
                            {addByTag.isPending ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : null}
                            Add
                          </Button>
                        </div>
                        <p
                          className={cn(
                            "text-[11px]",
                            addError ? "text-rose-200" : "text-[color:var(--aqt-fg-dim)]",
                          )}
                        >
                          {addError ??
                            "Joins the workspace roster and drops straight into this mix."}
                        </p>
                      </form>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            </div>

            {/* Column head. The three glyphs sit over the pickers below, so a
                host reads a rank column without a text label per row. */}
            <div className="flex shrink-0 items-center gap-2.5 border-y border-[color:var(--aqt-border)] bg-white/[0.015] px-4 py-1.5">
              <span aria-hidden="true" className="size-6 shrink-0" />
              <span className={cn(EYEBROW_CLASS, "min-w-0 flex-1")}>Player</span>
              <div aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
                {ROLES.map((role) => (
                  <span
                    key={role.code}
                    title={ROLE_LABELS[role.code]}
                    className="flex size-8 items-center justify-center opacity-70"
                  >
                    <PlayerRoleIcon role={role.icon} size={14} decorative />
                  </span>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1.5">
              {rosterQuery.isLoading ? (
                <div className="space-y-1 p-1">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
                    <Skeleton key={row} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : rosterQuery.isError && pageData == null ? (
                <PageStateCard
                  state="error"
                  title="Unable to load the roster"
                  description="Check your connection and try again."
                  actionLabel="Retry"
                  onAction={() => void rosterQuery.refetch()}
                  className="px-4 py-10"
                />
              ) : visible.length === 0 ? (
                <PageStateCard
                  state={deferredSearch ? "filtered-empty" : "empty"}
                  title={
                    deferredSearch
                      ? `Nobody matches \u201C${deferredSearch}\u201D`
                      : usingMine
                        ? "You haven't ranked anyone yet"
                        : "No players in this workspace yet"
                  }
                  description={
                    deferredSearch
                      ? "Try a different name, or add the BattleTag above."
                      : usingMine
                        ? "Set a rank on a player in Everyone to add them here."
                        : "Add a BattleTag above to start the roster this workspace balances from."
                  }
                  className="px-4 py-10"
                />
              ) : (
                <ul ref={listRef} className="space-y-0.5" aria-label="Workspace roster">
                  {visible.map((row, index) => (
                    <RosterRowItem
                      key={row.memberId}
                      row={row}
                      isInMix={inMix.has(row.memberId)}
                      isCursor={index === cursor}
                      canWrite={canWrite}
                      canEdit={canEditRanks}
                      isSaving={saveRank.isPending && saveRank.variables?.memberId === row.memberId}
                      onToggle={() => onTogglePlayer(row.memberId)}
                      onSaveRank={(role, rank) =>
                        saveRank.mutate({ memberId: row.memberId, role, rank })
                      }
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-3 border-t border-[color:var(--aqt-border)] px-4 py-2">
                <DataPagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  className="w-full"
                  summary={
                    pageData
                      ? pageData.total === 0
                        ? "0 players"
                        : `${(page - 1) * pageData.per_page + 1}\u2013${
                            (page - 1) * pageData.per_page + visible.length
                          } of ${pageData.total}`
                      : undefined
                  }
                />
            </div>
          </div>

          {/* ── The lineup ───────────────────────────────────────────────── */}
          <aside className="flex min-h-0 flex-col border-t border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)] lg:border-l lg:border-t-0">
            <div className="flex shrink-0 items-baseline gap-2 px-4 pb-2.5 pt-3.5">
              <h3 className={EYEBROW_CLASS}>In this mix</h3>
              <span className="ml-auto flex items-baseline gap-1 font-mono tabular-nums">
                <span
                  className={cn(
                    "text-xl font-bold leading-none",
                    overflow > 0
                      ? "text-[color:var(--aqt-amber)]"
                      : summary.active === LOBBY_SIZE
                        ? "text-[color:var(--aqt-teal)]"
                        : "text-[color:var(--aqt-fg)]",
                  )}
                >
                  {summary.active}
                </span>
                <span className="text-[13px] text-[color:var(--aqt-fg-faint)]">{`/ ${LOBBY_SIZE}`}</span>
              </span>
            </div>

            {/* The instrument panel. Supply against demand per role, counted the
                way the solver counts it, so "short one tank" is visible before
                Balance runs rather than inferred from a seated lineup after. */}
            <div className="grid shrink-0 grid-cols-3 gap-1.5 px-4 pb-3">
              {supply.map((entry) => {
                const icon = ROLES.find((role) => role.code === entry.role)?.icon ?? "Support";
                const short = entry.short > 0;
                return (
                  <div
                    key={entry.role}
                    title={
                      short
                        ? `${ROLE_LABELS[entry.role]}: ${entry.supply} of ${entry.need} — short ${entry.short}`
                        : `${ROLE_LABELS[entry.role]}: ${entry.supply} of ${entry.need}`
                    }
                    className="rounded-lg border border-[color:var(--aqt-border)] bg-black/20 px-2 pb-1.5 pt-1.5"
                  >
                    <div className="flex items-center gap-1">
                      <PlayerRoleIcon role={icon} size={13} decorative />
                      <span
                        className={cn(
                          "ml-auto font-mono text-[12px] font-semibold tabular-nums",
                          short
                            ? "text-[color:var(--aqt-amber)]"
                            : "text-[color:var(--aqt-emerald)]",
                        )}
                      >
                        {`${entry.supply}/${entry.need}`}
                      </span>
                    </div>
                    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-200",
                          short ? "bg-[color:var(--aqt-amber)]" : "bg-[color:var(--aqt-emerald)]",
                        )}
                        style={{
                          width: `${Math.min(100, Math.round((entry.supply / entry.need) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto border-t border-[color:var(--aqt-border)] px-2 py-1.5">
              {rows.length === 0 ? (
                <p className="px-2 py-8 text-center text-[12.5px] text-[color:var(--aqt-fg-dim)]">
                  Nobody yet. Pick from the left, or press Enter on the highlighted row.
                </p>
              ) : (
                <ul className="space-y-0.5" aria-label="Players in this mix">
                  {sortLineup(rows).map((row) => (
                    <LineupChip
                      key={row.workspace_member_id}
                      row={row}
                      canWrite={canWrite}
                      onRemove={() => onTogglePlayer(row.workspace_member_id)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-3 border-t border-[color:var(--aqt-border)] px-4 py-3">
              <p className="min-w-0 flex-1 text-[12px] leading-tight text-[color:var(--aqt-fg-dim)]">
                {overflow > 0
                  ? `${overflow} over a full lobby \u2014 bench the rest in the lineup.`
                  : overflow === 0
                    ? "A full lobby. Balance is ready to run."
                    : `${-overflow} more for a full lobby.`}
              </p>
              <Button type="button" className="h-9 shrink-0" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: Readonly<{ label: string; count: number | null; active: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-[12px] transition-colors",
        active
          ? "border-[color:color-mix(in_srgb,var(--aqt-teal)_38%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-teal)_12%,transparent)] text-[color:var(--aqt-teal)]"
          : "border-[color:var(--aqt-border)] bg-white/[0.02] text-[color:var(--aqt-fg-muted)] hover:bg-white/[0.05] hover:text-[color:var(--aqt-fg)]",
      )}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "rounded px-1 font-mono text-[11px] tabular-nums",
          active
            ? "bg-[color:color-mix(in_srgb,var(--aqt-teal)_18%,transparent)]"
            : "bg-white/[0.05] text-[color:var(--aqt-fg-faint)]",
        )}
      >
        {count ?? "\u2013"}
      </span>
    </button>
  );
}

/**
 * One roster row: membership on the left, identity in the middle, this host's
 * three ranks on the right.
 *
 * Membership is a 24px target rather than a whole-row click, because the row also
 * carries three popovers — a host correcting a rank must not join somebody to the
 * mix by missing a picker by four pixels. The keyboard path is the opposite
 * trade: the search field never loses focus, and Enter acts on the cursor row,
 * so adding twelve people is twelve keystrokes without a single pointer move.
 */
function RosterRowItem({
  row,
  isInMix,
  isCursor,
  canWrite,
  canEdit,
  isSaving,
  onToggle,
  onSaveRank,
}: Readonly<{
  row: RosterRow;
  isInMix: boolean;
  isCursor: boolean;
  canWrite: boolean;
  /** Whether the rank pickers write — the host's right, not the workspace's. */
  canEdit: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onSaveRank: (role: RoleCode, rank: number | null) => void;
}>) {
  const label = row.displayName || row.battleTag || `#${row.memberId}`;
  const { name, suffix } = splitBattleTag(label);

  return (
    <li
      data-roster-row
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg border px-2 py-1.5 transition-colors",
        // A left rail rather than a filled row: at 24 rows a wash of teal
        // fought the rank crests for attention, and "already in" is a state, not
        // an emphasis.
        isInMix
          ? "border-[color:var(--aqt-border)] bg-white/[0.02] before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-[color:var(--aqt-teal)]"
          : "border-transparent hover:border-[color:var(--aqt-border-2)] hover:bg-white/[0.025]",
        isCursor && "ring-1 ring-[color:color-mix(in_srgb,var(--aqt-teal)_45%,transparent)]",
      )}
    >
      <button
        type="button"
        disabled={!canWrite}
        aria-pressed={isInMix}
        aria-label={isInMix ? `Remove ${label} from this mix` : `Add ${label} to this mix`}
        onClick={onToggle}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors",
          isInMix
            ? "border-[color:color-mix(in_srgb,var(--aqt-teal)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-teal)_18%,transparent)] text-[color:var(--aqt-teal)]"
            : "border-[color:var(--aqt-border-2)] bg-black/20 text-[color:var(--aqt-fg-dim)] hover:text-[color:var(--aqt-fg)]",
          "disabled:cursor-default disabled:opacity-40",
        )}
      >
        {isInMix ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Plus className="size-3.5" aria-hidden="true" />
        )}
      </button>

      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span
          className="truncate text-[13.5px] font-semibold text-[color:var(--aqt-fg)]"
          title={label}
        >
          {name}
        </span>
        {suffix ? (
          <span className="shrink-0 font-mono text-[11.5px] text-[color:var(--aqt-fg-faint)]">
            {suffix}
          </span>
        ) : null}
        {isCursor && canWrite ? (
          <span
            aria-hidden="true"
            className="ml-auto shrink-0 text-[color:color-mix(in_srgb,var(--aqt-teal)_75%,transparent)]"
          >
            <CornerDownLeft className="size-3.5" />
          </span>
        ) : null}
      </span>

      <div className="flex shrink-0 items-center gap-1.5">
        {ROLES.map((role) => {
          const own = row.authorRanks[role.code] ?? null;
          const inherited = own == null ? (row.ranks[role.code] ?? null) : null;
          return (
            <span
              key={role.code}
              // Dimmed means "not yours": a picker that painted an inherited
              // number as if it were the host's own made "set" and "leave alone"
              // look identical, which is the exact mistake layered ranks exist
              // to make visible.
              className={cn("inline-flex", inherited != null && "opacity-45")}
            >
              <DivisionRankPicker
                rank={own ?? inherited}
                disabled={!canEdit || isSaving}
                label={
                  inherited == null
                    ? `${ROLE_LABELS[role.code]} rank for ${label}`
                    : `${ROLE_LABELS[role.code]} rank for ${label}, inherited ${inherited} from the workspace`
                }
                onChange={(next) => onSaveRank(role.code, next)}
                // The global OW grid: balancer-service resolves a mix's ranks
                // against the grid with `workspace_id=None`, so the value set
                // here is on the OW scale, not this workspace's.
                grid={OW_REFERENCE_GRID}
              />
            </span>
          );
        })}
      </div>
    </li>
  );
}

/**
 * One seated player, as the right column shows them: who, what they can play in
 * what order, what they are worth, and the way out.
 *
 * The role glyphs carry no numbers and no controls. Priority here is the
 * host-set order (`resolveRoleOrder`) so this list and the lineup panel behind
 * the dialog cannot disagree about what a player plays first, and editing
 * belongs to the lineup sheet, which has the room for it.
 */
function LineupChip({
  row,
  canWrite,
  onRemove,
}: Readonly<{ row: CustomGamePlayer; canWrite: boolean; onRemove: () => void }>) {
  const label = playerLabel(row);
  const { name, suffix } = splitBattleTag(label);
  const order = resolveRoleOrder(row);
  const rank = averageRank(row);

  return (
    <li
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.035]",
        !row.is_active && "opacity-55",
      )}
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-1">
        <span
          className="truncate text-[13px] font-semibold text-[color:var(--aqt-fg)]"
          title={label}
        >
          {name}
        </span>
        {suffix ? (
          <span className="shrink-0 font-mono text-[11px] text-[color:var(--aqt-fg-faint)]">
            {suffix}
          </span>
        ) : null}
      </span>

      <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
        {ROLES.map((role) => {
          const position = order.indexOf(role.code);
          return (
            <span
              key={role.code}
              className={cn(
                "flex size-5 items-center justify-center rounded",
                // A 9% fill is invisible at 20px, so first choice is marked the
                // way the lineup rail marks it — a 2px underline in the role
                // colour, which survives the size.
                position === -1 ? "opacity-20" : position === 0 ? ROLE_TILE_CLASS[role.code] : "",
              )}
            >
              <PlayerRoleIcon role={role.icon} size={13} decorative />
            </span>
          );
        })}
      </span>

      <span className="w-11 shrink-0 text-right font-mono text-[12.5px] font-semibold tabular-nums text-[color:var(--aqt-fg-muted)]">
        {rank ?? "\u2014"}
      </span>

      {canWrite ? (
        <button
          type="button"
          onClick={onRemove}
          title="Remove from this mix"
          className="flex size-5 shrink-0 items-center justify-center rounded text-[color:var(--aqt-fg-faint)] opacity-0 transition-opacity hover:text-[color:var(--aqt-rose)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{`Remove ${label} from this mix`}</span>
        </button>
      ) : (
        <span aria-hidden="true" className="size-5 shrink-0" />
      )}
    </li>
  );
}
