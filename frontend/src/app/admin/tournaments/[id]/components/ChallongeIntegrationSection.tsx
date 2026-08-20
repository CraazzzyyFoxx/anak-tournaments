"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, Loader2 } from "lucide-react";
import { EYEBROW_CLASS, TONE_CLASS, TONE_TEXT } from "@/components/admin/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { ChallongeSyncLogEntry } from "@/types/admin.types";
import { invalidateTournamentWorkspace } from "./tournamentWorkspace.queryKeys";

interface ChallongeIntegrationSectionProps {
  tournamentId: number;
  hasChallongeSource: boolean;
  /** Owned by the settings form: saved with the rest of the tournament. */
  slug: string;
  onSlugChange: (value: string) => void;
}

function formatSyncTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getLogTone(status: ChallongeSyncLogEntry["status"]) {
  if (status === "success") return TONE_CLASS.success;
  if (status === "conflict") return TONE_CLASS.warning;
  return TONE_CLASS.danger;
}

/**
 * Challonge link, sync triggers and sync log as one section.
 *
 * The link field used to sit in the settings form's "General information" card
 * while the sync buttons and log lived in a separate card further down the
 * page, so enabling sync meant editing one card to unlock another. They are one
 * connection, so they read as one block.
 *
 * Rendered inside the settings form, hence the explicit `type="button"`: an
 * unlabelled button in a form submits it.
 */
export function ChallongeIntegrationSection({
  tournamentId,
  hasChallongeSource,
  slug,
  onSlugChange
}: Readonly<ChallongeIntegrationSectionProps>) {
  const queryClient = useQueryClient();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["admin", "challonge-sync-log", tournamentId],
    queryFn: () => adminService.challongeSyncLog(tournamentId, 20),
    enabled: hasChallongeSource
  });

  const invalidateSyncLog = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin", "challonge-sync-log", tournamentId]
    });
  };

  const importMutation = useMutation({
    mutationFn: () => adminService.challongeImport(tournamentId),
    onSuccess: () => {
      invalidateSyncLog();
      void queryClient.invalidateQueries({
        queryKey: ["admin", "tournament", tournamentId]
      });
      invalidateTournamentWorkspace(queryClient, tournamentId);
      notify.success("Challonge import started", { description: "Sync log will update shortly." });
    }
  });

  const exportMutation = useMutation({
    mutationFn: () => adminService.challongeExport(tournamentId),
    onSuccess: () => {
      invalidateSyncLog();
      notify.success("Challonge export started", { description: "Sync log will update shortly." });
    }
  });

  const lastLog = logs[0];
  const failedLogCount = logs.filter((log) => log.status !== "success").length;
  const syncPending = importMutation.isPending || exportMutation.isPending;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className={EYEBROW_CLASS}>Challonge</h3>
        <Badge
          variant="outline"
          className={cn("shrink-0", TONE_CLASS[hasChallongeSource ? "accent" : "neutral"])}
        >
          {hasChallongeSource ? "Connected" : "Not linked"}
        </Badge>
      </div>

      <div>
        <Label htmlFor="settings-challonge" className="text-xs">
          Challonge URL or slug
        </Label>
        <Input
          id="settings-challonge"
          placeholder="e.g. my-tournament or https://challonge.com/my-tournament"
          value={slug}
          onChange={(event) => onSlugChange(event.target.value)}
          className="mt-1.5 bg-background/50"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!hasChallongeSource || importMutation.isPending}
          onClick={() => importMutation.mutate()}
        >
          {importMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ArrowDownToLine className="size-4" aria-hidden />
          )}
          {importMutation.isPending ? "Importing…" : "Import"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!hasChallongeSource || exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          {exportMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ArrowUpFromLine className="size-4" aria-hidden />
          )}
          {exportMutation.isPending ? "Exporting…" : "Export"}
        </Button>
      </div>

      {!hasChallongeSource ? (
        <p className="rounded-lg border border-dashed border-border/70 bg-muted/10 p-3 text-xs text-muted-foreground">
          Save a Challonge URL or a stage slug above to enable bracket sync.
        </p>
      ) : syncPending || isLoading || lastLog ? (
        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
        >
          <span className={EYEBROW_CLASS}>Last sync</span>
          {syncPending ? (
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Sync running — the log updates when it finishes.
            </span>
          ) : isLoading ? (
            <span>Loading sync state…</span>
          ) : lastLog ? (
            <>
              <Badge variant="outline" className={cn("h-5", getLogTone(lastLog.status))}>
                {lastLog.status}
              </Badge>
              <span className="text-foreground">
                {lastLog.direction} {lastLog.entity_type}
                {lastLog.entity_id ? ` #${lastLog.entity_id}` : ""}
              </span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{formatSyncTime(lastLog.created_at)}</span>
            </>
          ) : null}
          {failedLogCount > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className={TONE_TEXT.warning}>
                <span className="tabular-nums">{failedLogCount}</span> recent sync event
                {failedLogCount === 1 ? "" : "s"} need review.
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {hasChallongeSource ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className={EYEBROW_CLASS}>Sync log</p>
            <Badge variant="outline" className="tabular-nums">
              {logs.length} recent
            </Badge>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading sync log…</div>
          ) : logs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground">
              No sync history yet. Run an import or export to record the first event.
            </div>
          ) : (
            <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border/60">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center gap-2 border-b border-border/50 px-3 py-2 text-xs last:border-b-0"
                >
                  <Badge variant="outline" className="w-14 justify-center text-xs capitalize">
                    {log.direction}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn("w-16 justify-center text-xs", getLogTone(log.status))}
                  >
                    {log.status}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {log.entity_type}
                    {log.entity_id ? ` #${log.entity_id}` : ""}
                    {log.error_message ? ` · ${log.error_message}` : ""}
                  </span>
                  {log.challonge_id ? (
                    <span className="hidden items-center gap-1 text-muted-foreground lg:inline-flex">
                      <ExternalLink className="size-3" aria-hidden />
                      <span className="tabular-nums">{log.challonge_id}</span>
                    </span>
                  ) : null}
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatSyncTime(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
