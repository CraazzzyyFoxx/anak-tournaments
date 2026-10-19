"use client";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/kit/StatusPill";
import { EYEBROW_CLASS, TONE_TEXT, type Tone } from "@/components/kit/tone";
import type { ChecklistItem } from "@/components/admin/tournament-checklist";
import { cn } from "@/lib/utils";
import { PermissionHiddenNotice } from "./PermissionHiddenNotice";
import type { TournamentReadiness } from "@/types/admin.types";
import type { Tournament } from "@/types/tournament.types";

/** Open items shown here before the reader is sent to the hub's full checklist. */
const MAX_ACTIONS = 4;

const DRAFT_STATUSES = ["setup", "ready", "live", "paused", "completed", "cancelled"] as const;
type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** The two draft states that want attention get the card's one pill. */
const DRAFT_PILL_TONE: Partial<Record<DraftStatus, Tone>> = {
  live: "info",
  paused: "warning"
};

function isDraftStatus(value: string | null | undefined): value is DraftStatus {
  return DRAFT_STATUSES.includes(value as DraftStatus);
}

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

  // Rows bleed to the card edge (`-mx-6`) so the hover fill spans the card
  // instead of a framed box inside it.
  const shared = "flex items-center gap-2 -mx-6 px-6 py-2.5 transition-colors";

  if (!item.href) {
    return <div className={shared}>{body}</div>;
  }
  return (
    <HoverPrefetchLink
      href={item.href}
      className={cn(
        shared,
        "hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      )}
    >
      {body}
    </HoverPrefetchLink>
  );
}

interface ActiveTournamentReadinessProps {
  /** ANY(tournament.read, team.read) on the workspace — the readiness gate. */
  canRead: boolean;
  tournament: Tournament | null;
  readiness: TournamentReadiness | undefined;
  /** `buildChecklist` over `readiness`, built once by the dashboard. */
  items: ChecklistItem[];
  /** The item the dashboard's `NextActionHero` already shows. */
  heroKey?: string;
  isLoading: boolean;
  failed: boolean;
}

/**
 * The active tournament's readiness: the open checklist items the hero above
 * does not already show, plus its registration and team formation state.
 *
 * `items` is the hub Overview's `buildChecklist` model, so the dashboard can
 * never disagree with the hub about what is done. The backend masks field
 * groups the reader may not see (`null`), which `buildChecklist` turns into
 * `"no-access"` items — those are filtered out here instead of being shown as
 * work.
 */
export function ActiveTournamentReadiness({
  canRead,
  tournament,
  readiness,
  items,
  heroKey,
  isLoading,
  failed
}: Readonly<ActiveTournamentReadinessProps>) {
  const t = useTranslations("adminShell.dashboard");
  const tExtra = useTranslations("adminShell.dashboardExtra");
  const tDraft = useTranslations("draftAdmin.statuses");
  if (!canRead) {
    return (
      <Card>
        <CardContent className="pt-6">
          <PermissionHiddenNotice
            title={t("tournamentReadinessHidden")}
            description={t("permissionNoticeReadiness")}
          />
        </CardContent>
      </Card>
    );
  }

  // No active tournament: the card above already says so and offers the way out.
  if (!tournament) return null;

  const basePath = `/admin/tournaments/${tournament.id}`;

  // "skipped" (not applicable) and "no-access" (masked) items are neither work
  // nor progress, so they stay out of both the list and the denominator.
  const open = items.filter((item) => item.state === "todo" || item.state === "warn");
  const remaining = open.filter((item) => item.key !== heroKey);
  const actions = remaining.slice(0, MAX_ACTIONS);
  const doneCount = items.filter((item) => item.state === "done").length;
  const trackedCount = doneCount + open.length;

  // `registrations_approved` is the team-permission sentinel (D16): null means
  // the whole registration/formation group was masked, not that it is zero.
  const teamAccess = readiness?.registrations_approved != null;
  const draftFormation = readiness?.team_formation === "draft";
  const sessionStatus = readiness?.draft_session_status;
  const draftStatus = isDraftStatus(sessionStatus) ? sessionStatus : null;
  const draftPillTone = draftStatus ? DRAFT_PILL_TONE[draftStatus] : undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle asChild>
            <h2>{t("readiness")}</h2>
          </CardTitle>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-mt-1.5 shrink-0 text-muted-foreground"
          >
            <HoverPrefetchLink href={`${basePath}/overview`}>
              {t("fullChecklist")}
              <ArrowRight className="size-3.5" aria-hidden />
            </HoverPrefetchLink>
          </Button>
        </div>
        {trackedCount > 0 && (
          <CardDescription className="tabular-nums">
            {t("stepsDone", { done: doneCount, total: trackedCount })}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">
            {t("readinessLoadFailed")}
          </p>
        ) : actions.length > 0 ? (
          <div className="divide-y divide-border/50">
            {actions.map((item) => (
              <ActionRow key={item.key} item={item} />
            ))}
            {remaining.length > actions.length && (
              <p className="pt-2.5 text-xs text-muted-foreground">
                {t("moreInChecklist", { count: remaining.length - actions.length })}
              </p>
            )}
          </div>
        ) : open.length === 0 && trackedCount > 0 ? (
          <p className={cn("flex items-center gap-2 text-sm", TONE_TEXT.success)}>
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            {t("everyStepDone")}
          </p>
        ) : null}

        {/* Registration counts as one plain row of figures, not four framed
            tiles inside a framed card; the formation state sits in the same row. */}
        {teamAccess && readiness && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/50 pt-4 sm:grid-cols-5">
            <Figure label={t("pending")} value={readiness.registrations_pending ?? 0} warn />
            <Figure label={t("approved")} value={readiness.registrations_approved ?? 0} />
            <Figure label={t("checkedIn")} value={readiness.registrations_checked_in ?? 0} />
            <Figure label={t("ranked")} value={readiness.registrations_ranked ?? 0} />
            <div>
              <dt className={EYEBROW_CLASS}>{draftFormation ? tExtra("draft") : tExtra("balancer")}</dt>
              <dd className="mt-1 text-sm text-foreground">
                {draftFormation ? (
                  draftStatus && draftPillTone ? (
                    <StatusPill tone={draftPillTone}>{tDraft(draftStatus)}</StatusPill>
                  ) : draftStatus ? (
                    tDraft(draftStatus)
                  ) : (
                    tExtra("noSession")
                  )
                ) : (
                  <span className="tabular-nums">
                    {t.rich("poolReady", {
                      ready: readiness.pool_ready ?? 0,
                      needFix: readiness.pool_need_fix ?? 0,
                      warn: (chunks) => <span className={TONE_TEXT.warning}>{chunks}</span>
                    })}
                    {" · "}
                    {readiness.balance_saved ? t("balanceSaved") : t("balanceNotSaved")}
                    {readiness.balance_exported_at ? ` · ${t("exported")}` : null}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** One figure of the registration row: eyebrow above a tabular number. */
function Figure({
  label,
  value,
  warn = false
}: Readonly<{ label: string; value: number; warn?: boolean }>) {
  return (
    <div>
      <dt className={EYEBROW_CLASS}>{label}</dt>
      <dd
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          warn && value > 0 && TONE_TEXT.warning
        )}
      >
        {value}
      </dd>
    </div>
  );
}
