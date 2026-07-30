"use client";

import { History, Wifi, WifiOff } from "lucide-react";

import { CardDescription, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EYEBROW_CLASS, TONE_TEXT } from "@/components/admin/tone";
import { cn } from "@/lib/utils";
import { SurfaceCard, SurfaceCardContent, SurfaceCardHeader } from "./SurfaceCard";
import type { LogStreamState } from "@/hooks/useLogStream";
import type { LogProcessingStatus } from "@/types/admin.types";

/**
 * Broker queue names are infrastructure identifiers; they used to reach the
 * screen as `name.replace(/_/g, " ")`. Anything unmapped falls back to the
 * de-underscored name so a newly monitored queue still reads.
 */
const QUEUE_LABEL: Record<string, string> = {
  process_match_log: "Match log parsing",
  process_tournament_logs: "Tournament log batches",
  discord_commands: "Discord commands",
  balancer_jobs: "Balancer jobs",
};

const STATUS_LABEL: Record<LogProcessingStatus, string> = {
  pending: "Queued",
  processing: "Parsing",
  done: "Done",
  failed: "Failed",
};

const STATUS_TONE: Record<LogProcessingStatus, string> = {
  pending: "text-muted-foreground",
  processing: TONE_TEXT.info,
  done: TONE_TEXT.success,
  failed: TONE_TEXT.danger,
};

interface LogProcessingQueueProps {
  logStream: LogStreamState;
}

export function LogProcessingQueue({ logStream }: LogProcessingQueueProps) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle asChild className="flex items-center gap-2 text-sm">
              <h2>
                <History className="size-4 text-muted-foreground" aria-hidden />
                Log queue
              </h2>
            </CardTitle>
            <CardDescription className="mt-1 text-xs">Real-time queue depths</CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
            <span className="flex items-center gap-1.5">
              {logStream.connected ? (
                <>
                  <Wifi className={cn("size-3.5", TONE_TEXT.success)} aria-hidden />
                  <span className={TONE_TEXT.success}>Live</span>
                </>
              ) : (
                <>
                  <WifiOff className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">Not live</span>
                </>
              )}
            </span>
            {logStream.lastUpdated && (
              <span className="tabular-nums text-muted-foreground">
                Updated {logStream.lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-4">
        <section className="space-y-2">
          <h3 className={EYEBROW_CLASS}>Queue depths</h3>
          {logStream.queues.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {logStream.queues.map((q) => {
                const isOffline = q.status === "not_found";
                const isError = q.status === "error";
                const isUnavailable = isOffline || isError;
                const label = QUEUE_LABEL[q.name] ?? q.name.replace(/_/g, " ");

                return (
                  <div
                    key={q.name}
                    className={cn(
                      "space-y-2 rounded-xl border p-3",
                      isUnavailable
                        ? "border-border/30 bg-background/25"
                        : "border-border/50 bg-background/45",
                    )}
                  >
                    <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
                    {isUnavailable ? (
                      <>
                        <span
                          className={cn(
                            "text-xs font-medium",
                            isError ? TONE_TEXT.danger : TONE_TEXT.neutral,
                          )}
                        >
                          {isError ? "Unreachable" : "Not declared"}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {isError
                            ? "The broker did not answer. Check that RabbitMQ is reachable."
                            : "The queue is not declared yet. Start its consumer service."}
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-end justify-between gap-2">
                          <span className="text-2xl font-semibold tabular-nums">
                            {q.messages_ready}
                          </span>
                          {q.messages_unacknowledged > 0 && (
                            <span className={cn("text-xs tabular-nums", TONE_TEXT.warning)}>
                              +{q.messages_unacknowledged} processing
                            </span>
                          )}
                        </div>
                        <Progress
                          value={Math.min(100, q.messages_ready * 10)}
                          className="h-1"
                          aria-label={`${label} backlog`}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {logStream.connected
                ? "No queues are reporting yet. Depths refresh every few seconds."
                : logStream.error
                  ? `Queue depths are unavailable while the log service is unreachable. It is retried automatically — ${logStream.error}`
                  : "Connecting to the log service… depths appear once it answers."}
            </p>
          )}
        </section>

        {logStream.recentLogs.length > 0 && (
          <section className="space-y-2">
            <h3 className={EYEBROW_CLASS}>Recent activity</h3>
            <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50">
              {logStream.recentLogs.slice(0, 6).map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between gap-3 bg-background/40 px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium uppercase",
                        STATUS_TONE[record.status],
                      )}
                    >
                      {STATUS_LABEL[record.status]}
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {record.filename.split("/").at(-1)}
                    </span>
                  </div>
                  {record.uploader_name && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {record.uploader_name}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
