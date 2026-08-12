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
import { useWorkspaceStore } from "@/stores/workspace.store";

import { StatusBadge, formatDate } from "./rank-shared";

const STATUS_FILTERS = ["all", "ok", "private", "not_found", "error", "rate_limited"];
const SOURCE_FILTERS = ["all", "scheduled", "registration", "manual"];

interface RankTaskHistoryProps {
  onSelectUser: (userId: number, label: string) => void;
}

/** Live OverFast worker fetch log. Rows resolve to a player (when known) and are
 *  clickable through to that player's detail. */
export function RankTaskHistory({ onSelectUser }: RankTaskHistoryProps) {
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  // Rows come back scoped to the workspace `apiFetch` injects — key on it so a
  // workspace switch refetches instead of showing the previous tenant's history.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const query = useQuery({
    queryKey: ["admin", "rank", "fetch-log", workspaceId, status, source],
    queryFn: () =>
      adminService.getRankFetchLog({
        status: status === "all" ? undefined : status,
        source: source === "all" ? undefined : source,
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
            <h2>Task history</h2>
          </CardTitle>
          <span className="flex items-center gap-1 text-xs font-normal text-success">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            live
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {value === "all" ? "All statuses" : value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_FILTERS.map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {value === "all" ? "All sources" : value}
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
            No fetch tasks recorded yet. The worker logs a row here each time it queries OverFast —
            resume collection or collect a single player to see activity.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Battle tag</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Snapshots</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const userId = row.user_id;
                  const clickable = userId != null;
                  const open = () => onSelectUser(userId as number, row.battle_tag);
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
                            {row.battle_tag}
                          </button>
                        ) : (
                          row.battle_tag
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.source}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{row.snapshots_written || "—"}</TableCell>
                      <TableCell
                        className="max-w-64 truncate text-xs text-danger"
                        title={row.error ?? undefined}
                      >
                        {row.error ?? "—"}
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
