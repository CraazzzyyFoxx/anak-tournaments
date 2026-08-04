"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";
import userService from "@/services/user.service";

import {
  PROVIDER_LABELS,
  REASON_LABELS,
  STATE_BAR,
  StateBadge,
  formatDate,
  formatRelative
} from "./subscription-shared";

interface SelectUser {
  (userId: number, label: string): void;
}

// ─── Player search (header combobox) ─────────────────────────────────────────

/** Compact search that lives in the page header; matches drop down below the
 *  input and open the player detail on select. */
export function SubscriptionPlayerSearch({ onSelect }: { onSelect: SelectUser }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(handle);
  }, [term]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const searchQuery = useQuery({
    queryKey: ["admin", "subscriptions", "user-search", debounced],
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
        aria-label="Search player by name"
        placeholder="Search player by name…"
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
            <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
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
              No player matches “{debounced}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Per-player check timeline ───────────────────────────────────────────────

/**
 * That player's own slice of the check log, newest first.
 *
 * The counterpart of `RankHistory` on the rank tab: the entitlement table only
 * holds the latest verdict, so this is the only place a flap ("active on Monday,
 * inactive on Friday, active again after a re-subscribe") is visible at all.
 */
function PlayerCheckTimeline({ userId }: { userId: number }) {
  const query = useQuery({
    queryKey: ["admin", "subscriptions", "user-history", userId],
    queryFn: () => adminService.getSubscriptionCheckLog({ user_id: userId, limit: 100 })
  });
  const rows = query.data ?? [];

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Check history</h3>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          No checks recorded for this player yet.
        </p>
      ) : (
        <ol className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {rows.map((row) => {
            const reason = row.error ?? (row.reason ? (REASON_LABELS[row.reason] ?? row.reason) : null);
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-border/60 bg-card/50 px-2.5 py-1.5 text-xs"
              >
                <span aria-hidden className={cn("h-2 w-2 rounded-full", STATE_BAR[row.state] ?? "bg-muted")} />
                <span className="tabular-nums text-muted-foreground">{formatDate(row.created_at)}</span>
                <span className="font-medium">{PROVIDER_LABELS[row.provider] ?? row.provider}</span>
                <span>{row.state}</span>
                {row.tier_label || row.tier_rank != null ? (
                  <span className="text-muted-foreground">
                    {row.tier_label ?? `Tier ${row.tier_rank}`}
                  </span>
                ) : null}
                <span className="text-muted-foreground">· {row.source}</span>
                {reason ? (
                  <span className={cn("truncate", row.error ? "text-danger" : "text-muted-foreground")}>
                    · {reason}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ─── Player detail dialog ─────────────────────────────────────────────────────

interface SubscriptionPlayerDetailProps {
  userId: number;
  label: string;
  onClose: () => void;
}

export function SubscriptionPlayerDetail({ userId, label, onClose }: SubscriptionPlayerDetailProps) {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["admin", "subscriptions", "collection", userId],
    queryFn: () => adminService.getSubscriptionCollectionStatus(userId)
  });
  const rows = statusQuery.data ?? [];

  const triggerMutation = useMutation({
    mutationFn: (providers: string[] | null) =>
      adminService.triggerSubscriptionCollection({ user_id: userId, providers }),
    onSuccess: (result) => {
      notify.success(
        result.checked > 0
          ? `Checked ${result.checked} subscription(s)`
          : "Nothing to check — this player is not registered in a tournament that requires a subscription"
      );
      queryClient.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    },
    onError: (error) =>
      notify.apiError(error, { title: "Could not re-check the subscription — try again" })
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Current entitlements</h3>
              <Button size="sm" disabled={triggerMutation.isPending} onClick={() => triggerMutation.mutate(null)}>
                {triggerMutation.isPending ? (
                  <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                )}
                Re-check now
              </Button>
            </div>

            {statusQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                No subscription verdict stored for this player. Either they have no linked auth
                account, or nothing has ever checked them — subscriptions are only resolved for
                tournaments whose registration form requires one.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Checked</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.workspace_id}-${row.provider}`}>
                      <TableCell className="text-sm">{row.workspace_name ?? row.workspace_id ?? "—"}</TableCell>
                      <TableCell className="font-medium">
                        {PROVIDER_LABELS[row.provider] ?? row.provider}
                      </TableCell>
                      <TableCell title={row.source ?? undefined}>
                        <StateBadge state={row.state} />
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {row.tier_label ?? (row.tier_rank != null ? `Tier ${row.tier_rank}` : "—")}
                      </TableCell>
                      <TableCell
                        className="text-sm tabular-nums text-muted-foreground"
                        title={formatDate(row.checked_at)}
                      >
                        {formatRelative(row.checked_at)}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                        {row.reason ? (REASON_LABELS[row.reason] ?? row.reason) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={triggerMutation.isPending}
                          onClick={() => triggerMutation.mutate([row.provider])}
                          aria-label={`Re-check ${row.provider} for ${label}`}
                        >
                          <RefreshCw aria-hidden className="mr-1 h-3 w-3" />
                          Re-check
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <PlayerCheckTimeline userId={userId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
