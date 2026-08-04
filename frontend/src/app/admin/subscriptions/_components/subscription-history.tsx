"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import adminService from "@/services/admin.service";

import {
  PROVIDER_LABELS,
  REASON_LABELS,
  StateBadge,
  formatDate
} from "./subscription-shared";

const STATE_FILTERS = ["all", "active", "inactive", "unknown", "error"];
const SOURCE_FILTERS = ["all", "scheduled", "registration", "check_in", "manual", "redeem"];
const PROVIDER_FILTERS = ["all", "boosty", "twitch"];

interface SubscriptionHistoryProps {
  onSelectUser: (userId: number, label: string) => void;
}

/**
 * Live subscription check history — one row per real provider call.
 *
 * This is the view the subscription domain had no data for: `entitlement` is
 * overwritten in place on every check, so before `check_log` existed there was
 * no way to see that a player flapped, when a provider went down, or why a
 * registration was refused. Rows resolve to a player (when the auth account has
 * a profile) and are clickable through to that player's detail.
 */
export function SubscriptionTaskHistory({ onSelectUser }: SubscriptionHistoryProps) {
  const [state, setState] = useState("all");
  const [source, setSource] = useState("all");
  const [provider, setProvider] = useState("all");

  const query = useQuery({
    queryKey: ["admin", "subscriptions", "check-log", state, source, provider],
    queryFn: () =>
      adminService.getSubscriptionCheckLog({
        state: state === "all" ? undefined : state,
        source: source === "all" ? undefined : source,
        provider: provider === "all" ? undefined : provider,
        limit: 50
      }),
    refetchInterval: 3000
  });
  const rows = query.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle asChild>
            <h2>Check history</h2>
          </CardTitle>
          <span className="flex items-center gap-1 text-xs font-normal text-success">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            live
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label="Filter by state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATE_FILTERS.map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {value === "all" ? "All states" : value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_FILTERS.map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {value === "all" ? "All providers" : (PROVIDER_LABELS[value] ?? value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_FILTERS.map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {value === "all" ? "All triggers" : value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            No subscription checks recorded yet. A row lands here each time a provider is actually
            queried — resume collection, run &ldquo;Check all now&rdquo;, or wait for a player to
            register in a tournament that requires a subscription.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const userId = row.user_id;
                  const clickable = userId != null;
                  const label = row.user_name ?? `auth #${row.auth_user_id ?? "?"}`;
                  const open = () => onSelectUser(userId as number, label);
                  const reason = row.error ?? (row.reason ? (REASON_LABELS[row.reason] ?? row.reason) : null);
                  return (
                    <TableRow
                      key={row.id}
                      className={cn(clickable && "cursor-pointer hover:bg-muted/50")}
                      onClick={clickable ? open : undefined}
                    >
                      <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {formatDate(row.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {clickable ? (
                          // The row is clickable for the mouse; this button is what
                          // keyboard users reach. `stopPropagation` keeps the row
                          // handler from firing the same open twice.
                          <button
                            type="button"
                            className="text-primary underline-offset-2 hover:underline"
                            onClick={(event) => {
                              event.stopPropagation();
                              open();
                            }}
                          >
                            {label}
                          </button>
                        ) : (
                          label
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {PROVIDER_LABELS[row.provider] ?? row.provider}
                      </TableCell>
                      <TableCell>
                        <StateBadge state={row.state} />
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {row.tier_label ?? (row.tier_rank != null ? `Tier ${row.tier_rank}` : "—")}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground" title={row.mechanism ?? undefined}>
                        {row.source}
                      </TableCell>
                      <TableCell
                        className={cn("max-w-64 truncate text-xs", row.error ? "text-danger" : "text-muted-foreground")}
                        title={row.error ?? row.reason ?? undefined}
                      >
                        {reason ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
