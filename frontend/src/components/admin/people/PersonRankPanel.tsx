"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useFormatter } from "@/lib/datetime/client";

import RankHistory from "@/components/RankHistory";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useClickOutside } from "@/hooks/useClickOutside";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import rankService from "@/services/rank.service";
import userService from "@/services/user.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { CurrentRank } from "@/types/rank.types";

import { StatusBadge, formatDate } from "@/components/admin/collectors/rank-shared";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { Spinner } from "@/components/ui/spinner";
import { adminQueryKeys } from "@/lib/admin/query-keys";

interface SelectUser {
  (userId: number, label: string): void;
}

// ─── Player search (header combobox) ─────────────────────────────────────────

/** Compact search that lives in the page header; matches drop down below the
 *  input and open the player detail on select. */
export function RankPlayerSearch({ onSelect }: Readonly<{ onSelect: SelectUser }>) {
  const t = useTranslations("adminPeople.rank");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [debouncedTerm] = useDebounce(term, 300);
  const debounced = debouncedTerm.trim();

  useClickOutside(containerRef, () => setOpen(false));

  const searchQuery = useQuery({
    queryKey: adminQueryKeys.rankUserSearch(debounced),
    queryFn: () => userService.searchUsers(debounced),
    enabled: debounced.length >= 2
  });
  const results = searchQuery.data ?? [];
  const showDropdown = open && debounced.length >= 2;

  const pick = (id: number, name: string) => {
    onSelect(id, name);
    setOpen(false);
    setTerm("");
  };

  return (
    <div ref={containerRef} className="relative w-full sm:w-72">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        className="pl-8"
        aria-label={t("searchLabel")}
        placeholder={t("search")}
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          {searchQuery.isLoading ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t("searching")}</p>
          ) : results.length > 0 ? (
            <div className="max-h-72 divide-y divide-border overflow-y-auto">
              {results.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => pick(user.id, user.name)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  {user.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t("noMatch", { query: debounced })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Current ranks (native OverFast division/tier per role) ──────────────────

function rankLabel(rank: CurrentRank, unrankedLabel: string): string {
  if (!rank.is_ranked || !rank.division) return unrankedLabel;
  const division = rank.division.charAt(0).toUpperCase() + rank.division.slice(1);
  return rank.tier != null ? `${division} ${rank.tier}` : division;
}

/** The ranked rows of a player's current ranks; the cache entry the rank tab and the glance share. */
export function useCurrentRanks(userId: number) {
  const query = useQuery({
    queryKey: adminQueryKeys.rankCurrent(userId),
    queryFn: () => rankService.getUserCurrentRanks(userId)
  });
  return { isLoading: query.isLoading, ranks: (query.data?.ranks ?? []).filter((r) => r.is_ranked) };
}

export function CurrentRankChips({ ranks }: Readonly<{ ranks: CurrentRank[] }>) {
  const t = useTranslations("adminPeople.rank");
  return (
    <div className="flex flex-wrap gap-2">
      {ranks.map((rank) => (
        <span
          key={`${rank.social_account_id}-${rank.role}-${rank.platform}`}
          className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
          title={[rank.battle_tag, rank.platform].join(" · ")}
        >
          <span className="capitalize text-muted-foreground">{rank.role}</span>
          <span className="font-medium">{rankLabel(rank, t("unranked"))}</span>
        </span>
      ))}
    </div>
  );
}

function CurrentRanksSection({ userId }: Readonly<{ userId: number }>) {
  const t = useTranslations("adminPeople.rank");
  const { isLoading, ranks } = useCurrentRanks(userId);
  if (isLoading || ranks.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t("current")}</h3>
      <CurrentRankChips ranks={ranks} />
    </section>
  );
}

// ─── Per-player rank collection ──────────────────────────────────────────────

/**
 * One player's rank collection state, with the re-fetch controls.
 *
 * Moved out of the rank collector screen: a person's rank belongs on their
 * card (People › Identity), and the collector page keeps it only until its own
 * WU drops the player lookup.
 */
export function RankPlayerPanel({ userId }: Readonly<{ userId: number }>) {
  const t = useTranslations("adminPeople.rank");
  const format = useFormatter();
  const queryClient = useQueryClient();
  // Scoped server-side to the injected workspace; see `admin.service.ts`.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());

  const statusQuery = useQuery({
    queryKey: adminQueryKeys.rankCollection(workspaceId, userId),
    queryFn: () => adminService.getRankCollectionStatus(userId)
  });
  const rows = statusQuery.data ?? [];

  const triggerMutation = useMutation({
    mutationFn: (socialAccountIds: number[] | null) =>
      adminService.triggerRankCollection({ user_id: userId, social_account_ids: socialAccountIds }),
    onSuccess: (result) => {
      notify.success(t("queued", { count: result.enqueued }));
      setSelectedTagIds(new Set());
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.rank() });
    },
    onError: (error) =>
      notify.apiError(error, { title: t("queueError") })
  });

  const toggleTag = (id: number) =>
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-5">
      <CurrentRanksSection userId={userId} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("collection")}</h3>
          <div className="flex items-center gap-2">
            {selectedTagIds.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={triggerMutation.isPending}
                onClick={() => triggerMutation.mutate([...selectedTagIds])}
              >
                <span className="tabular-nums">{t("collectSelected", { count: selectedTagIds.size })}</span>
              </Button>
            )}
            <Button
              size="sm"
              disabled={triggerMutation.isPending}
              onClick={() => triggerMutation.mutate(null)}
            >
              {triggerMutation.isPending ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <RefreshCw aria-hidden className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("collectAll")}
            </Button>
          </div>
        </div>

        {statusQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyNote>
            {t("noTags")}
          </EmptyNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{t("battleTag")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("lastChecked")}</TableHead>
                <TableHead>{t("lastSuccess")}</TableHead>
                <TableHead className="text-right">{t("failures")}</TableHead>
                <TableHead className="text-right">{t("action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.social_account_id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedTagIds.has(row.social_account_id)}
                      onCheckedChange={() => toggleTag(row.social_account_id)}
                      aria-label={t("select", { battleTag: row.battle_tag })}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{row.battle_tag}</TableCell>
                  <TableCell title={row.last_error ?? undefined}>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {formatDate(format, row.last_checked_at)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {formatDate(format, row.last_success_at)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {row.consecutive_failures || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={triggerMutation.isPending}
                      onClick={() => triggerMutation.mutate([row.social_account_id])}
                      aria-label={t("collectFor", { battleTag: row.battle_tag })}
                    >
                      <RefreshCw aria-hidden className="mr-1 h-3 w-3" />
                      {t("collect")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <RankHistory userId={userId} title={t("history")} />
    </div>
  );
}

// ─── Player detail dialog ─────────────────────────────────────────────────────

interface RankPlayerDetailProps {
  userId: number;
  label: string;
  onClose: () => void;
}

/** The dialog wrapper the rank collector screen still opens from its lookup. */
export function RankPlayerDetail({ userId, label, onClose }: Readonly<RankPlayerDetailProps>) {
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>

        <RankPlayerPanel userId={userId} />
      </DialogContent>
    </Dialog>
  );
}
