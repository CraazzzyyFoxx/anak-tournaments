"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlert, Clock, FolderInput, Loader2, RefreshCw, XCircle, CheckCircle } from "lucide-react";
import { AdminDetailTableShell, getAdminDetailTableStyles } from "@/components/admin/AdminDetailTable";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import adminService from "@/services/admin.service";
import { TOURNAMENT_DETAIL_PREVIEW_LIMIT } from "./tournamentWorkspace.helpers";
import { getTournamentWorkspaceQueryKeys } from "./tournamentWorkspace.queryKeys";

interface TournamentLogsTabProps {
  tournamentId: number;
  enabled: boolean;
}

export function TournamentLogsTab({ tournamentId, enabled }: TournamentLogsTabProps) {
  const { toast } = useToast();
  const tableStyles = getAdminDetailTableStyles("compact");
  const queryKeys = getTournamentWorkspaceQueryKeys(tournamentId);

  const logHistoryQuery = useQuery({
    queryKey: queryKeys.logHistory,
    queryFn: () => adminService.getLogHistory(tournamentId, { limit: 50 }),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });

  const retryLogMutation = useMutation({
    mutationFn: (recordId: number) => adminService.retryLogRecord(recordId),
    onSuccess: () => logHistoryQuery.refetch(),
  });

  const processAllLogsMutation = useMutation({
    mutationFn: () => adminService.processAllTournamentLogs(tournamentId),
    onSuccess: () => {
      toast({ title: "Processing queued for all S3 logs" });
      logHistoryQuery.refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderInput className="size-4 shrink-0 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">Log Processing History</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={processAllLogsMutation.isPending}
            onClick={() => processAllLogsMutation.mutate()}
          >
            {processAllLogsMutation.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <FolderInput className="size-3" />
            )}
            Process All S3 Logs
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => logHistoryQuery.refetch()}
            disabled={logHistoryQuery.isFetching}
          >
            <RefreshCw
              className={`size-3.5 ${logHistoryQuery.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {logHistoryQuery.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !logHistoryQuery.data?.items.length ? (
          <p className="p-4 text-sm text-muted-foreground">No log processing records yet.</p>
        ) : (
          <>
            <AdminDetailTableShell variant="compact">
              <Table>
                <TableHeader>
                  <TableRow className={tableStyles.headerRow}>
                    <TableHead className={tableStyles.head}>Filename</TableHead>
                    <TableHead className={tableStyles.head}>Status</TableHead>
                    <TableHead className={tableStyles.head}>Source</TableHead>
                    <TableHead className={tableStyles.head}>Uploader</TableHead>
                    <TableHead className={tableStyles.head}>Uploaded</TableHead>
                    <TableHead className={tableStyles.head}>Duration</TableHead>
                    <TableHead className={tableStyles.head}></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logHistoryQuery.data.items
                    .slice(0, TOURNAMENT_DETAIL_PREVIEW_LIMIT)
                    .map((record) => {
                      const duration =
                        record.started_at && record.finished_at
                          ? `${((new Date(record.finished_at).getTime() - new Date(record.started_at).getTime()) / 1000).toFixed(1)}s`
                          : record.status === "processing"
                            ? "In progress..."
                            : "—";

                      const statusInfo =
                        record.status === "pending"
                          ? { icon: Clock, variant: "muted" as const }
                          : record.status === "processing"
                            ? { icon: Loader2, variant: "info" as const }
                            : record.status === "done"
                              ? { icon: CheckCircle, variant: "success" as const }
                              : record.status === "failed"
                                ? { icon: XCircle, variant: "destructive" as const }
                                : { icon: CircleAlert, variant: "muted" as const };

                      return (
                        <TableRow key={record.id} className={tableStyles.row}>
                          <TableCell className={tableStyles.cell}>
                            <span className="font-mono text-xs">
                              {record.filename.split("/").at(-1)}
                            </span>
                            {record.error_message ? (
                              <p className="mt-1 line-clamp-1 text-xs text-destructive">
                                {record.error_message}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            <StatusIcon
                              icon={statusInfo.icon}
                              label={record.status}
                              variant={statusInfo.variant}
                            />
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            <span className="text-sm capitalize text-muted-foreground">
                              {record.source}
                            </span>
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            {record.uploader_name ? (
                              <span className="text-sm">{record.uploader_name}</span>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            <span className="text-sm">
                              {new Date(record.created_at).toLocaleString()}
                            </span>
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            <span className="text-sm text-muted-foreground">{duration}</span>
                          </TableCell>
                          <TableCell className={tableStyles.cell}>
                            {record.status === "failed" ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Retry processing"
                                disabled={
                                  retryLogMutation.isPending &&
                                  retryLogMutation.variables === record.id
                                }
                                onClick={() => retryLogMutation.mutate(record.id)}
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </AdminDetailTableShell>

            {logHistoryQuery.data.items.length > TOURNAMENT_DETAIL_PREVIEW_LIMIT ? (
              <div className="border-t border-border/30 px-3 py-2 text-[12px] text-muted-foreground/60">
                Showing {TOURNAMENT_DETAIL_PREVIEW_LIMIT} of {logHistoryQuery.data.items.length} logs
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
