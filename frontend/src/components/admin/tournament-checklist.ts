import type { useTranslations } from "next-intl";

import type { TournamentReadiness } from "@/types/admin.types";
import type { StageSummary, Tournament, TournamentStatus } from "@/types/tournament.types";

/** The `adminTournaments.checklist` translator of the component that renders the checklist. */
export type ChecklistTranslator = ReturnType<typeof useTranslations<"adminTournaments.checklist">>;

/**
 * Living-checklist model for the Overview tab (design §3, D22, D16).
 *
 * Pure function over the readiness aggregate: applicability predicates decide
 * which items exist (inapplicable items are omitted, except explicitly
 * "skipped" ones like an unscheduled check-in), field masking decides
 * "no-access". Hrefs point at the FINAL tab addresses (D20) — `registration`
 * ships in T8, `matches?tab=logs` in Phase 2 — links are already correct.
 */

/**
 * A tournament sources its bracket from Challonge — its own registration form
 * does not apply. Lockstep across the hub's overview/teams/matches/settings
 * tabs and the admin dashboard, so it lives beside `ChecklistContext` rather
 * than in a route module.
 */
export function hasChallongeSource(
  tournament: Tournament | undefined,
  stages: readonly StageSummary[]
): boolean {
  return Boolean(
    tournament?.challonge_slug || stages.some((stage) => Boolean(stage.challonge_slug))
  );
}

export type ChecklistState = "done" | "todo" | "warn" | "skipped" | "no-access";

/** Lifecycle phases with work in them; the status itself lives in the PhaseStrip. */
export type ChecklistPhase = "setup" | "registration" | "formation" | "bracket" | "live";

export interface ChecklistItem {
  key: string;
  phase: ChecklistPhase;
  state: ChecklistState;
  label: string;
  detail?: string;
  href?: string;
}

export interface ChecklistContext {
  /** Hub base path, e.g. `/admin/tournaments/42`. */
  basePath: string;
  /** Statuses present in tournament_phase_schedule. */
  schedule: readonly TournamentStatus[];
  /** Bracket is Challonge-sourced — own registration form does not apply (§3). */
  hasChallongeSource: boolean;
}

export function buildChecklist(
  readiness: TournamentReadiness,
  ctx: ChecklistContext,
  t: ChecklistTranslator
): ChecklistItem[] {
  // The backend masks each permission group as a whole (D16), so one sentinel
  // field per group tells access apart from a legitimate zero/null value.
  const setupAccess = readiness.schedule_configured != null;
  const teamAccess = readiness.registrations_approved != null;

  const settingsHref = `${ctx.basePath}/settings/general`;
  const registrationHref = `${ctx.basePath}/registration/entries`;
  const teamsHref = `${ctx.basePath}/teams/roster`;
  const stagesHref = `${ctx.basePath}/bracket`;

  const items: ChecklistItem[] = [];

  // ── Setup ──────────────────────────────────────────────────────────────
  items.push({
    key: "schedule",
    phase: "setup",
    label: t("phaseSchedule"),
    state: !setupAccess ? "no-access" : readiness.schedule_configured ? "done" : "todo",
    href: settingsHref
  });
  items.push({
    key: "grid",
    phase: "setup",
    label: t("divisionGrid"),
    state: !setupAccess ? "no-access" : readiness.grid_selected ? "done" : "todo",
    href: settingsHref
  });
  if (!ctx.hasChallongeSource) {
    items.push({
      key: "registration_form",
      phase: "setup",
      label: t("registrationForm"),
      state: !teamAccess
        ? "no-access"
        : readiness.registration_form_configured
          ? "done"
          : "todo",
      href: `${ctx.basePath}/settings/registration`
    });
    items.push({
      key: "registration_open",
      phase: "setup",
      label: t("registrationOpen"),
      state: !teamAccess ? "no-access" : readiness.registration_open ? "done" : "todo",
      href: registrationHref
    });
  }

  // ── Registration ───────────────────────────────────────────────────────
  const approved = readiness.registrations_approved ?? 0;
  items.push({
    key: "approved",
    phase: "registration",
    label: t("approvedRegistrations"),
    // Informational, no threshold (§3) — never nags about a count.
    state: !teamAccess ? "no-access" : "done",
    detail: teamAccess
      ? t("approvedDetail", { approved, pending: readiness.registrations_pending ?? 0 })
      : undefined,
    href: registrationHref
  });
  const ranked = readiness.registrations_ranked ?? 0;
  items.push({
    key: "ranks",
    phase: "registration",
    label: t("ranksCovered"),
    state: !teamAccess ? "no-access" : approved > 0 && ranked >= approved ? "done" : "todo",
    detail: teamAccess ? t("rankedDetail", { ranked, approved }) : undefined,
    href: registrationHref
  });
  const checkInScheduled = ctx.schedule.includes("check_in");
  const checkedIn = readiness.registrations_checked_in ?? 0;
  items.push({
    key: "check_in",
    phase: "registration",
    label: t("checkIn"),
    state: !checkInScheduled
      ? "skipped"
      : !teamAccess
        ? "no-access"
        : approved > 0 && checkedIn >= approved
          ? "done"
          : "todo",
    detail: checkInScheduled && teamAccess ? t("checkedInDetail", { checkedIn, approved }) : undefined,
    href: registrationHref
  });

  // ── Formation (by team_formation, §3) ──────────────────────────────────
  if (readiness.team_formation === "draft") {
    const draftStatus = readiness.draft_session_status;
    items.push({
      key: "draft_completed",
      phase: "formation",
      label: t("draftCompleted"),
      state: !teamAccess ? "no-access" : draftStatus === "completed" ? "done" : "todo",
      detail:
        !teamAccess || draftStatus === "completed"
          ? undefined
          : draftStatus
            ? t("sessionDetail", { status: draftStatus })
            : t("noDraftSession"),
      // The draft board, not the roster: it is where a draft is run.
      href: `${ctx.basePath}/teams/draft`
    });
  } else {
    const poolReady = readiness.pool_ready ?? 0;
    const poolNeedFix = readiness.pool_need_fix ?? 0;
    items.push({
      key: "pool_ready",
      phase: "formation",
      label: t("playerPoolReady"),
      state: !teamAccess
        ? "no-access"
        : poolNeedFix > 0
          ? "warn"
          : poolReady > 0
            ? "done"
            : "todo",
      detail: teamAccess
        ? t("poolDetail", { ready: poolReady, needFix: poolNeedFix })
        : undefined,
      href: teamsHref
    });
    items.push({
      key: "balance_saved",
      phase: "formation",
      label: t("balanceSaved"),
      state: !teamAccess ? "no-access" : readiness.balance_saved ? "done" : "todo",
      href: teamsHref
    });
    items.push({
      key: "balance_exported",
      phase: "formation",
      label: t("balanceExported"),
      state: !teamAccess ? "no-access" : readiness.balance_exported_at != null ? "done" : "todo",
      href: teamsHref
    });
  }

  // ── Bracket ────────────────────────────────────────────────────────────
  items.push({
    key: "stages",
    phase: "bracket",
    label: t("stagesConfigured"),
    state: !setupAccess ? "no-access" : (readiness.stages_total ?? 0) > 0 ? "done" : "todo",
    href: stagesHref
  });
  items.push({
    key: "slots",
    phase: "bracket",
    label: t("stageSlotsFilled"),
    state: !setupAccess ? "no-access" : readiness.stage_slots_filled ? "done" : "todo",
    href: stagesHref
  });
  items.push({
    key: "bracket",
    phase: "bracket",
    label: t("bracketGenerated"),
    state: !setupAccess ? "no-access" : readiness.bracket_generated ? "done" : "todo",
    href: stagesHref
  });

  // ── Live ───────────────────────────────────────────────────────────────
  const encountersTotal = readiness.encounters_total ?? 0;
  const withLogs = readiness.encounters_with_logs ?? 0;
  items.push({
    key: "logs",
    phase: "live",
    label: t("logsCoverMatches"),
    // Neutral until the first log arrives (§3: otherwise "Logs: not used").
    state: !setupAccess
      ? "no-access"
      : !readiness.logs_used
        ? "skipped"
        : encountersTotal > 0 && withLogs >= encountersTotal
          ? "done"
          : "warn",
    detail: !setupAccess
      ? undefined
      : !readiness.logs_used
        ? t("logsNotUsed")
        : t("logsDetail", { withLogs, total: encountersTotal }),
    href: `${ctx.basePath}/matches/logs`
  });

  return items;
}
