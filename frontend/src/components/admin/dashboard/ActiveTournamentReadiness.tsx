"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, ListChecks } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import { EYEBROW_CLASS, TONE_CLASS, TONE_TEXT, type Tone } from "@/components/admin/tone";
import {
  buildChecklist,
  hasChallongeSource,
  type ChecklistItem,
} from "@/components/admin/tournament-checklist";
import { cn } from "@/lib/utils";
import { PermissionHiddenNotice } from "./PermissionHiddenNotice";
import { SurfaceCard, SurfaceCardContent, SurfaceCardHeader } from "./SurfaceCard";
import type { TournamentReadiness } from "@/types/admin.types";
import type { Tournament } from "@/types/tournament.types";

/** Open items shown here before the reader is sent to the hub's full checklist. */
const MAX_ACTIONS = 4;

/** Draft lifecycle read as a tone. Anything unmapped stays neutral. */
const DRAFT_TONE: Record<string, Tone> = {
  completed: "success",
  live: "info",
  paused: "warning",
  cancelled: "danger",
};

function ActionRow({ item }: Readonly<{ item: ChecklistItem }>) {
  const tone: Tone = item.state === "warn" ? "warning" : "neutral";
  const Icon = item.state === "warn" ? AlertTriangle : Circle;
  const body = (
    <>
      <Icon className={cn("size-3.5 shrink-0", TONE_TEXT[tone])} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.label}</span>
      {item.detail ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.detail}</span>
      ) : null}
    </>
  );

  const shared =
    "flex items-center gap-2 bg-background/40 px-3 py-2.5 transition-colors";

  if (!item.href) {
    return <div className={shared}>{body}</div>;
  }
  return (
    <Link
      href={item.href}
      className={cn(
        shared,
        "hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      {body}
    </Link>
  );
}

interface ActiveTournamentReadinessProps {
  /** ANY(tournament.read, team.read) on the workspace — the readiness gate. */
  canRead: boolean;
  tournament: Tournament | null;
  readiness: TournamentReadiness | undefined;
  isLoading: boolean;
  failed: boolean;
}

/**
 * What still blocks the active tournament, plus its registration and team
 * formation state.
 *
 * Reads the same `/admin/tournaments/{id}/readiness` aggregate and the same
 * `buildChecklist` model as the hub's Overview tab, so the dashboard can never
 * disagree with the hub about what is done. The backend masks field groups the
 * reader may not see (`null`), which `buildChecklist` turns into `"no-access"`
 * items — those are filtered out here instead of being shown as work.
 */
export function ActiveTournamentReadiness({
  canRead,
  tournament,
  readiness,
  isLoading,
  failed,
}: ActiveTournamentReadinessProps) {
  if (!canRead) {
    return (
      <SurfaceCard>
        <SurfaceCardContent className="pt-5">
          <PermissionHiddenNotice
            title="Tournament readiness is hidden"
            permission="tournament read or team read"
          />
        </SurfaceCardContent>
      </SurfaceCard>
    );
  }

  // No active tournament: the card above already says so and offers the way out.
  if (!tournament) return null;

  const basePath = `/admin/tournaments/${tournament.id}`;
  const items =
    readiness && !failed
      ? buildChecklist(readiness, {
          basePath,
          schedule: tournament.phase_schedule.map((entry) => entry.status),
          hasChallongeSource: hasChallongeSource(tournament, tournament.stages ?? []),
        })
      : [];

  // "skipped" (not applicable) and "no-access" (masked) items are neither work
  // nor progress, so they stay out of both the list and the denominator.
  const open = items.filter((item) => item.state === "todo" || item.state === "warn");
  const actions = open.slice(0, MAX_ACTIONS);
  const doneCount = items.filter((item) => item.state === "done").length;
  const trackedCount = doneCount + open.length;

  // `registrations_approved` is the team-permission sentinel (D16): null means
  // the whole registration/formation group was masked, not that it is zero.
  const teamAccess = readiness?.registrations_approved != null;
  const draftFormation = readiness?.team_formation === "draft";

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg border border-border/50 bg-background/60">
              <ListChecks className="size-3.5 text-muted-foreground" aria-hidden />
            </div>
            <CardTitle asChild className="text-sm">
              <h2>Next actions</h2>
            </CardTitle>
          </div>
          <Button asChild variant="ghost" size="sm" className="-mt-1 shrink-0 text-muted-foreground">
            <Link href={`${basePath}/overview`}>
              Full checklist
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
        {trackedCount > 0 && (
          <CardDescription className="text-xs tabular-nums">
            {doneCount} of {trackedCount} steps done
          </CardDescription>
        )}
      </SurfaceCardHeader>

      <SurfaceCardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">
            Readiness could not be loaded. Open the tournament to see its checklist.
          </p>
        ) : actions.length > 0 ? (
          <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50">
            {actions.map((item) => (
              <ActionRow key={item.key} item={item} />
            ))}
            {open.length > actions.length && (
              <div className="bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                <span className="tabular-nums">{open.length - actions.length}</span> more in the
                full checklist
              </div>
            )}
          </div>
        ) : (
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm",
              TONE_CLASS.success,
            )}
          >
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            Every applicable step is done.
          </div>
        )}

        {teamAccess && readiness && (
          <>
            <StatTileGrid>
              <StatTile
                label="Pending"
                value={readiness.registrations_pending ?? 0}
                detail="Awaiting a decision"
                tone={(readiness.registrations_pending ?? 0) > 0 ? "warning" : "neutral"}
              />
              <StatTile label="Approved" value={readiness.registrations_approved ?? 0} />
              <StatTile label="Checked in" value={readiness.registrations_checked_in ?? 0} />
              <StatTile
                label="Ranked"
                value={readiness.registrations_ranked ?? 0}
                detail="Saved rank data"
              />
            </StatTileGrid>

            <div className="flex flex-wrap items-center gap-2">
              <span className={EYEBROW_CLASS}>
                {draftFormation ? "Draft" : "Balancer"}
              </span>
              {draftFormation ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    TONE_CLASS[
                      readiness.draft_session_status
                        ? (DRAFT_TONE[readiness.draft_session_status] ?? "neutral")
                        : "neutral"
                    ],
                  )}
                >
                  {readiness.draft_session_status ?? "No session"}
                </Badge>
              ) : (
                <>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs tabular-nums",
                      TONE_CLASS[(readiness.pool_need_fix ?? 0) > 0 ? "warning" : "success"],
                    )}
                  >
                    Pool {readiness.pool_ready ?? 0} ready
                    {(readiness.pool_need_fix ?? 0) > 0
                      ? ` · ${readiness.pool_need_fix} need fixing`
                      : ""}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      TONE_CLASS[readiness.balance_saved ? "success" : "neutral"],
                    )}
                  >
                    {readiness.balance_saved ? "Balance saved" : "Balance not saved"}
                  </Badge>
                  {readiness.balance_exported_at && (
                    <Badge variant="outline" className={cn("text-xs", TONE_CLASS.success)}>
                      Exported
                    </Badge>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
