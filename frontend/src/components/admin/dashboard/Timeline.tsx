"use client";

import { useTranslations } from "next-intl";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { formatRelative } from "@/components/kit/format-time";
import { StatusPill } from "@/components/kit/StatusPill";
import { TONE_CLASS } from "@/components/ui/tone";
import { Skeleton } from "@/components/ui/skeleton";
import { GameIcon } from "@/components/workspace/GameIcon";
import { useFormatter } from "@/lib/datetime/client";
import { cn } from "@/lib/utils";
import type { DashboardTimelineEvent, DashboardTournamentCard } from "@/types/admin-dashboard.types";
import type { TournamentStatus } from "@/types/tournament.types";
import { Block, BlockError } from "./Block";

/**
 * Phase-schedule boundaries of the next seven days. An overdue start (a phase
 * the tournament should have entered and has not) is pinned to the left in the
 * error tone: it is the one entry that is already late.
 */
export function Timeline({
  events,
  cardOf,
  failed,
  onRetry
}: Readonly<{
  /** `undefined` while loading. */
  events: DashboardTimelineEvent[] | undefined;
  cardOf: ReadonlyMap<number, DashboardTournamentCard>;
  failed: boolean;
  onRetry: () => void;
}>) {
  const t = useTranslations("adminShell.dashboard");
  const tStatus = useTranslations("common.statusBadge");
  const format = useFormatter();
  const title = t("timeline");

  if (failed) {
    return (
      <Block title={title}>
        <BlockError title={title} onRetry={onRetry} />
      </Block>
    );
  }
  if (!events) {
    return (
      <Block title={title}>
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-44 shrink-0 rounded-lg" />
          ))}
        </div>
      </Block>
    );
  }

  const ordered = [...events.filter((event) => event.overdue), ...events.filter((event) => !event.overdue)];

  return (
    <Block title={title}>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("timelineEmpty")}</p>
      ) : (
        <ol className="flex gap-2 overflow-x-auto pb-1">
          {ordered.map((event) => {
            const phase = tStatus(event.status as TournamentStatus);
            const card = cardOf.get(event.tournament_id);
            return (
              <li key={`${event.tournament_id}:${event.status}:${event.edge}`} className="shrink-0">
                <HoverPrefetchLink
                  href={`/admin/tournaments/${event.tournament_id}/settings/schedule`}
                  className={cn(
                    "flex w-44 flex-col gap-1 rounded-lg border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    event.overdue ? TONE_CLASS.danger : "border-border/60 text-muted-foreground hover:bg-accent/30"
                  )}
                >
                  <span className="font-medium tabular-nums">
                    {event.overdue
                      ? formatRelative(format, event.at)
                      : format.dateTime(new Date(event.at), {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    {card ? <GameIcon slug={card.discipline} /> : null}
                    <span className="truncate text-sm text-foreground">{event.tournament_name}</span>
                    {card?.is_hidden ? (
                      <StatusPill tone="neutral" className="shrink-0">
                        {t("hidden")}
                      </StatusPill>
                    ) : null}
                  </span>
                  <span>
                    {event.overdue
                      ? t("edgeOverdue", { phase })
                      : t(event.edge === "start" ? "edgeStart" : "edgeEnd", { phase })}
                  </span>
                </HoverPrefetchLink>
              </li>
            );
          })}
        </ol>
      )}
    </Block>
  );
}
