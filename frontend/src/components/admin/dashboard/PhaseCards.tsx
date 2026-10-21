"use client";

import { useState, type ReactNode } from "react";
import { useNow, useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Circle, Lock } from "lucide-react";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import { buildChecklist, type ChecklistItem } from "@/components/admin/tournament-checklist";
import { formatRelative } from "@/components/kit/format-time";
import { StatusPill } from "@/components/kit/StatusPill";
import { EYEBROW_CLASS, TONE_TEXT, type Tone } from "@/components/kit/tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { GameIcon } from "@/components/workspace/GameIcon";
import { useFormatter } from "@/lib/datetime/client";
import { cn } from "@/lib/utils";
import type { DashboardTournamentCard } from "@/types/admin-dashboard.types";
import type { TournamentStatus } from "@/types/tournament.types";

/** Cards shown before the rest fold into "N more", in the backend's priority order. */
const VISIBLE_CARDS = 3;
/** Open checklist items a card lists before pointing at the hub's full checklist. */
const MAX_CHECKLIST_ITEMS = 3;

const GRID_CLASS = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

export function PhaseCards({ cards }: Readonly<{ cards: DashboardTournamentCard[] }>) {
  const t = useTranslations("adminShell.dashboard");
  const [open, setOpen] = useState(false);
  const rest = cards.slice(VISIBLE_CARDS);

  return (
    <section aria-labelledby="dashboard-cards" className="flex flex-col gap-3">
      <h2 id="dashboard-cards" className="sr-only">
        {t("cardsTitle")}
      </h2>
      <div className={GRID_CLASS}>
        {cards.slice(0, VISIBLE_CARDS).map((card) => (
          <PhaseCard key={card.id} card={card} />
        ))}
      </div>
      {rest.length > 0 ? (
        <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
          <CollapsibleContent className={GRID_CLASS}>
            {rest.map((card) => (
              <PhaseCard key={card.id} card={card} />
            ))}
          </CollapsibleContent>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-fit text-muted-foreground">
              {open ? t("fewerCards") : t("moreCards", { count: rest.length })}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            </Button>
          </CollapsibleTrigger>
        </Collapsible>
      ) : null}
    </section>
  );
}

export function PhaseCardsSkeleton() {
  return (
    <div className={GRID_CLASS}>
      {Array.from({ length: VISIBLE_CARDS }, (_, index) => (
        <Skeleton key={index} className="h-60 rounded-xl" />
      ))}
    </div>
  );
}

function PhaseCard({ card }: Readonly<{ card: DashboardTournamentCard }>) {
  const t = useTranslations("adminShell.dashboard");
  const tStatus = useTranslations("common.statusBadge");
  const format = useFormatter();
  const base = `/admin/tournaments/${card.id}`;
  const status = tStatus(card.status as TournamentStatus);
  // Formation and live each span two statuses; the status says which one.
  const phaseLine =
    card.phase === "formation" || card.phase === "live"
      ? `${t(`phase.${card.phase}`)} · ${status}`
      : t(`phase.${card.phase}`);
  // The one way in: the existing screen where this phase's work is done.
  const actionHref = {
    preparation: `${base}/settings/general`,
    registration: `${base}/registration/entries`,
    formation: card.team_formation === "draft" ? `${base}/teams/draft` : `${base}/teams/roster`,
    live: `${base}/matches/encounters`,
    wrap_up: `${base}/overview`
  }[card.phase];

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-1.5 space-y-0 pb-4">
        <p className={EYEBROW_CLASS}>{phaseLine}</p>
        <div className="flex min-w-0 items-center gap-2">
          <GameIcon slug={card.discipline} size={16} />
          <CardTitle asChild className="min-w-0 truncate text-base">
            <h3>
              <HoverPrefetchLink href={base} className="hover:underline focus-visible:underline">
                {card.name}
              </HoverPrefetchLink>
            </h3>
          </CardTitle>
          {card.is_hidden ? (
            <StatusPill tone="neutral" className="shrink-0">
              {t("hidden")}
            </StatusPill>
          ) : null}
        </div>
        {card.next_deadline_at ? (
          <p className="text-xs text-muted-foreground">
            {t("nextDeadline", { when: formatRelative(format, card.next_deadline_at) })}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex-1">
        {card.phase === "registration" ? (
          <RegistrationBody card={card} />
        ) : card.phase === "live" ? (
          <PlayBody card={card} />
        ) : card.phase === "wrap_up" ? (
          <WrapUpBody card={card} />
        ) : (
          <ChecklistBody card={card} />
        )}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" size="sm">
          <HoverPrefetchLink href={actionHref}>
            {t(`action.${card.phase}`)}
            <ArrowRight className="size-3.5" aria-hidden />
          </HoverPrefetchLink>
        </Button>
      </CardFooter>
    </Card>
  );
}

function NoAccess() {
  const tCommon = useTranslations("common");
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Lock className="size-3.5 shrink-0" aria-hidden />
      {tCommon("noAccess")}
    </p>
  );
}

/**
 * Preparation and formation: the hub's own living checklist, open items only.
 * `buildChecklist` already drops what the card's status no longer needs, so a
 * formation card never nags "registration form" after registration closed.
 */
function ChecklistBody({ card }: Readonly<{ card: DashboardTournamentCard }>) {
  const t = useTranslations("adminShell.dashboard");
  const tChecklist = useTranslations("adminTournaments.checklist");
  const items = buildChecklist(
    card.readiness,
    {
      basePath: `/admin/tournaments/${card.id}`,
      status: card.status as TournamentStatus,
      hasChallongeSource: card.has_challonge_source
    },
    tChecklist
  );
  // Masked groups come back as "no-access" items: neither work nor progress.
  if (items.every((item) => item.state === "no-access" || item.state === "skipped")) return <NoAccess />;
  const open = items.filter((item) => item.state === "todo" || item.state === "warn");
  if (open.length === 0) {
    return (
      <p className={cn("flex items-center gap-2 text-sm", TONE_TEXT.success)}>
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        {t("everyStepDone")}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border/50">
      {open.slice(0, MAX_CHECKLIST_ITEMS).map((item) => (
        <li key={item.key}>
          <ChecklistRow item={item} />
        </li>
      ))}
      {open.length > MAX_CHECKLIST_ITEMS ? (
        <li className="pt-2 text-xs text-muted-foreground">
          {t("moreInChecklist", { count: open.length - MAX_CHECKLIST_ITEMS })}
        </li>
      ) : null}
    </ul>
  );
}

function ChecklistRow({ item }: Readonly<{ item: ChecklistItem }>) {
  const warn = item.state === "warn";
  const Icon = warn ? AlertTriangle : Circle;
  const body = (
    <>
      <Icon className={cn("size-3.5 shrink-0", TONE_TEXT[warn ? "warning" : "neutral"])} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.label}</span>
      {item.detail ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.detail}</span>
      ) : null}
    </>
  );
  // Bleeds to the card edge so the hover fill spans the card.
  const shared = "-mx-6 flex items-center gap-2 px-6 py-2";
  if (!item.href) return <div className={shared}>{body}</div>;
  return (
    <HoverPrefetchLink
      href={item.href}
      className={cn(
        shared,
        "transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      )}
    >
      {body}
    </HoverPrefetchLink>
  );
}

/**
 * A label over a tabular figure; coloured only when it is a non-zero problem.
 * The label wraps instead of truncating (three cards in a row leave ~90px per
 * figure), and `justify-between` keeps a row's values on one baseline when one
 * label takes two lines.
 */
function Figure({ label, value, tone }: Readonly<{ label: string; value: ReactNode; tone?: Tone }>) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1">
      <dt className="text-xs leading-tight text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone && typeof value === "number" && value > 0 && TONE_TEXT[tone]
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** The funnel pending, approved, ranked, checked in; then the pace and the deadline. */
function RegistrationBody({ card }: Readonly<{ card: DashboardTournamentCard }>) {
  const t = useTranslations("adminShell.dashboard");
  const format = useFormatter();
  const readiness = card.readiness;
  const closesAt = card.registration_closes_at;
  const now = useNow();
  const closed = closesAt != null && new Date(closesAt).getTime() < now.getTime();
  return (
    <div className="flex flex-col gap-3">
      {/* `registrations_approved` is the team.read sentinel: null masks the whole group. */}
      {readiness.registrations_approved == null ? (
        <NoAccess />
      ) : (
        <dl className="grid grid-cols-4 gap-2">
          <Figure label={t("pending")} value={readiness.registrations_pending} tone="warning" />
          <Figure label={t("approved")} value={readiness.registrations_approved} />
          <Figure label={t("ranked")} value={readiness.registrations_ranked} />
          <Figure label={t("checkedIn")} value={readiness.registrations_checked_in} />
        </dl>
      )}
      <ul className="space-y-1 text-xs text-muted-foreground">
        {card.registrations_last_24h != null ? (
          <li className="tabular-nums">{t("registrationsLast24h", { count: card.registrations_last_24h })}</li>
        ) : null}
        {closesAt ? (
          <li className={cn(closed && TONE_TEXT.warning)}>
            {t(closed ? "registrationOverdue" : "registrationCloses", { when: formatRelative(format, closesAt) })}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function PlayBody({ card }: Readonly<{ card: DashboardTournamentCard }>) {
  const t = useTranslations("adminShell.dashboard");
  const play = card.play;
  if (!play) return <NoAccess />;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      <Figure
        label={t("play.completed")}
        value={t("playProgress", { completed: play.encounters_completed, total: play.encounters_total })}
      />
      <Figure label={t("play.live")} value={play.encounters_live} />
      <Figure label={t("play.overdue")} value={play.encounters_overdue} tone="danger" />
      <Figure label={t("play.pendingConfirmation")} value={play.encounters_pending_confirmation} tone="warning" />
      <Figure label={t("play.disputed")} value={play.encounters_disputed} tone="danger" />
    </dl>
  );
}

/** The four wrap-up conditions; a masked one says so instead of passing for done. */
function WrapUpBody({ card }: Readonly<{ card: DashboardTournamentCard }>) {
  const t = useTranslations("adminShell.dashboard");
  const wrapUp = card.wrap_up;
  if (!wrapUp) return null;

  const resultsOpen = wrapUp.results_open;
  const withLogs = wrapUp.duel_encounters_with_logs ?? 0;
  const duels = wrapUp.duel_encounters_total ?? 0;
  const achievements = wrapUp.achievements_status;
  const recalc = wrapUp.standings_recalc_pending;
  // `done: null` is a condition the reader may not see.
  const conditions: { key: string; label: string; done: boolean | null; text: string }[] = [
    {
      key: "results",
      label: t("wrapUp.results"),
      done: resultsOpen == null ? null : resultsOpen === 0,
      text: resultsOpen ? t("wrapUp.resultsOpen", { count: resultsOpen }) : t("wrapUp.resultsDone")
    },
    {
      key: "logs",
      label: t("wrapUp.logs"),
      done: wrapUp.logs_used == null ? null : !wrapUp.logs_used || withLogs >= duels,
      text: !wrapUp.logs_used
        ? t("wrapUp.logsNotUsed")
        : withLogs >= duels
          ? t("wrapUp.logsDone")
          : t("wrapUp.logsOpen", { withLogs, total: duels })
    },
    {
      key: "achievements",
      label: t("wrapUp.achievements"),
      done: achievements == null ? null : achievements === "done" || achievements === "not_configured",
      text:
        achievements === "not_configured"
          ? t("wrapUp.achievementsNotConfigured")
          : achievements === "done"
            ? t("wrapUp.achievementsDone")
            : t("wrapUp.achievementsOpen")
    },
    {
      key: "standings",
      label: t("wrapUp.standings"),
      done: recalc == null ? null : !recalc,
      text: recalc ? t("wrapUp.standingsOpen") : t("wrapUp.standingsDone")
    }
  ];

  return (
    <ul className="space-y-2">
      {conditions.map((condition) => {
        const Icon = condition.done == null ? Lock : condition.done ? CheckCircle2 : Circle;
        const tone: Tone = condition.done == null ? "neutral" : condition.done ? "success" : "warning";
        return (
          <li key={condition.key} className="flex items-start gap-2 text-sm">
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", TONE_TEXT[tone])} aria-hidden />
            <span className={cn(condition.done == null && "text-muted-foreground")}>
              {condition.done == null ? t("wrapUp.restricted", { label: condition.label }) : condition.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
