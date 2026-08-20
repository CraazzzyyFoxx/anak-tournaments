import type { Encounter } from "@/types/encounter.types";
import type { Stage, Standings, Tournament } from "@/types/tournament.types";
import type { TournamentPhaseScheduleEntryInput, TournamentUpdateInput } from "@/types/admin.types";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/timezone";
import type { RosterSlotMap } from "@/lib/roster-shape";
import { normalizeSlots } from "@/components/admin/tournaments/roster-shape-editor.model";
import { normalizeChallongeSlug } from "@/lib/challonge";

export const SCHEDULABLE_PHASES = ["registration", "check_in", "draft", "live"] as const;

export type SchedulablePhase = (typeof SCHEDULABLE_PHASES)[number];

export type PhaseScheduleFormState = Record<
  SchedulablePhase,
  { starts_at: string; ends_at: string }
>;

export type TournamentFormState = {
  name: string;
  description: string;
  challonge_slug: string;
  is_league: boolean;
  is_finished: boolean;
  is_hidden: boolean;
  start_date: string;
  end_date: string;
  win_points: number;
  draw_points: number;
  loss_points: number;
  auto_transitions_enabled: boolean;
  allow_late_registration: boolean;
  phase_schedule: PhaseScheduleFormState;
  division_grid_version_id: number | null;
  team_formation: string;
  /**
   * Roster shape override; `null` = inherit. Normalized on the way in so the
   * tab's `JSON.stringify` dirty check does not trip over key order.
   */
  roster_slots_json: RosterSlotMap | null;
};

export type EncounterFormState = {
  name: string;
  stage_id: number | null;
  stage_item_id: number | null;
  home_team_id: number | null;
  away_team_id: number | null;
  round: number;
  home_score: number;
  away_score: number;
  status: string;
};

export type StandingFormState = {
  position: number;
  points: number;
  win: number;
  draw: number;
  lose: number;
};

export type StandingSortKey = "position" | "team" | "scope" | "points" | "win" | "draw" | "lose";

export type StandingSortState = {
  key: StandingSortKey;
  dir: "asc" | "desc";
} | null;

export type StandingGroupOption = {
  id: string;
  name: string;
  stageOrder: number;
  itemOrder: number;
};

export type EncounterGroupOption = {
  id: string;
  name: string;
  stageOrder: number;
  itemOrder: number;
};

export const TOURNAMENT_DETAIL_PREVIEW_LIMIT = 8;

export function formatDate(value?: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function toDateInput(value?: Date | string | null) {
  if (!value) return "";
  return new Date(value).toISOString().split("T")[0] ?? "";
}

function getPhaseScheduleForm(
  tournament: Tournament,
  timezone: string
): PhaseScheduleFormState {
  const schedule = Object.fromEntries(
    SCHEDULABLE_PHASES.map((phase) => [phase, { starts_at: "", ends_at: "" }])
  ) as PhaseScheduleFormState;

  for (const row of tournament.phase_schedule ?? []) {
    if ((SCHEDULABLE_PHASES as readonly string[]).includes(row.status)) {
      schedule[row.status as SchedulablePhase] = {
        starts_at: utcToZonedInput(row.starts_at, timezone),
        ends_at: utcToZonedInput(row.ends_at, timezone)
      };
    }
  }

  return schedule;
}

export function getPhaseSchedulePayload(
  schedule: PhaseScheduleFormState,
  timezone: string
): TournamentPhaseScheduleEntryInput[] {
  return SCHEDULABLE_PHASES.filter((phase) => schedule[phase].starts_at).map((phase) => ({
    status: phase,
    starts_at: zonedInputToUtc(schedule[phase].starts_at, timezone) ?? schedule[phase].starts_at,
    ends_at: zonedInputToUtc(schedule[phase].ends_at, timezone)
  }));
}

export function getTournamentForm(tournament: Tournament, timezone: string): TournamentFormState {
  return {
    name: tournament.name,
    description: tournament.description ?? "",
    challonge_slug: tournament.challonge_slug ?? "",
    is_league: tournament.is_league,
    is_finished: tournament.is_finished,
    is_hidden: tournament.is_hidden ?? false,
    start_date: toDateInput(tournament.start_date),
    end_date: toDateInput(tournament.end_date),
    win_points: tournament.win_points ?? 1,
    draw_points: tournament.draw_points ?? 0.5,
    loss_points: tournament.loss_points ?? 0,
    auto_transitions_enabled: tournament.auto_transitions_enabled ?? true,
    allow_late_registration: tournament.allow_late_registration ?? false,
    phase_schedule: getPhaseScheduleForm(tournament, timezone),
    division_grid_version_id: tournament.division_grid_version_id ?? null,
    team_formation: tournament.team_formation ?? "balancer",
    roster_slots_json: tournament.roster_slots_json
      ? normalizeSlots(tournament.roster_slots_json)
      : null
  };
}

// Every field `TournamentUpdateInput` can carry, keyed the same as
// `TournamentFormState` (minus `phase_schedule`, which travels through
// `setTournamentSchedule` instead). Kept in one place so the diff below and
// `getTournamentForm` above cannot drift out of sync field-by-field.
type TournamentUpdateValues = Required<Omit<TournamentUpdateInput, "description" | "challonge_slug" | "division_grid_version_id" | "roster_slots_json">> & {
  description: string | null;
  challonge_slug: string | null;
  division_grid_version_id: number | null;
  roster_slots_json: RosterSlotMap | null;
};

function normalizeTournamentFormValues(form: TournamentFormState): TournamentUpdateValues {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    challonge_slug: form.challonge_slug ? normalizeChallongeSlug(form.challonge_slug) : null,
    is_league: form.is_league,
    is_finished: form.is_finished,
    is_hidden: form.is_hidden,
    start_date: form.start_date,
    end_date: form.end_date,
    win_points: form.win_points,
    draw_points: form.draw_points,
    loss_points: form.loss_points,
    auto_transitions_enabled: form.auto_transitions_enabled,
    allow_late_registration: form.allow_late_registration,
    division_grid_version_id: form.division_grid_version_id,
    team_formation: form.team_formation,
    roster_slots_json: form.roster_slots_json
  };
}

/**
 * Diffs the (normalized) current form against the (normalized) initial form
 * and keeps only the fields that actually changed. The admin audit trail
 * records exactly the keys a PATCH sends (`TournamentUpdate.model_dump(exclude_unset=True)`
 * on the backend), so sending every field on every save -- even ones the
 * admin never touched -- made every edit look like a full rewrite of the
 * tournament in the audit log.
 */
export function getTournamentUpdatePayload(
  current: TournamentFormState,
  initial: TournamentFormState
): TournamentUpdateInput {
  const next = normalizeTournamentFormValues(current);
  const prev = normalizeTournamentFormValues(initial);
  const payload: TournamentUpdateInput = {};
  for (const key of Object.keys(next) as (keyof TournamentUpdateValues)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(prev[key])) {
      (payload as Record<string, unknown>)[key] = next[key];
    }
  }
  return payload;
}

export function getEmptyEncounterForm(
  defaultStageId: number | null,
  defaultStageItemId: number | null
): EncounterFormState {
  return {
    name: "",
    stage_id: defaultStageId,
    stage_item_id: defaultStageItemId,
    home_team_id: null,
    away_team_id: null,
    round: 1,
    home_score: 0,
    away_score: 0,
    status: "open"
  };
}

export function getEncounterForm(encounter: Encounter): EncounterFormState {
  return {
    name: encounter.name,
    stage_id: encounter.stage_id ?? null,
    stage_item_id: encounter.stage_item_id ?? null,
    home_team_id: encounter.home_team_id,
    away_team_id: encounter.away_team_id,
    round: encounter.round,
    home_score: encounter.score.home,
    away_score: encounter.score.away,
    status: encounter.status
  };
}

export function getStandingForm(standing: Standings): StandingFormState {
  return {
    position: standing.position,
    points: standing.points,
    win: standing.win,
    draw: standing.draw,
    lose: standing.lose
  };
}

export function getEncounterStageLabel(encounter: Encounter) {
  return encounter.stage_item?.name ?? encounter.stage?.name ?? "-";
}

export function getEncounterScopeKey(encounter: Encounter): string {
  if (encounter.stage_item_id != null) return `stage-item-${encounter.stage_item_id}`;
  if (encounter.stage_id != null) return `stage-${encounter.stage_id}`;
  return "unassigned";
}

export function getStageScopeGroups(stages: Stage[]): EncounterGroupOption[] {
  return stages
    .flatMap((stage) => {
      if (stage.items.length === 0) {
        return [
          {
            id: `stage-${stage.id}`,
            name: stage.name,
            stageOrder: stage.order,
            itemOrder: Number.MAX_SAFE_INTEGER
          }
        ];
      }

      return stage.items.map((item) => ({
        id: `stage-item-${item.id}`,
        name: item.name,
        stageOrder: stage.order,
        itemOrder: item.order
      }));
    })
    .sort(
      (left, right) =>
        left.stageOrder - right.stageOrder ||
        left.itemOrder - right.itemOrder ||
        left.name.localeCompare(right.name)
    );
}

export function getStandingScopeKey(standing: Standings): string {
  if (standing.stage_item_id != null) return `stage-item-${standing.stage_item_id}`;
  if (standing.stage_id != null) return `stage-${standing.stage_id}`;
  return `standing-${standing.id}`;
}

export function getStandingScopeLabel(standing: Standings): string {
  return standing.stage_item?.name ?? standing.stage?.name ?? "-";
}

export function getStandingGroups(standings: Standings[]): StandingGroupOption[] {
  return Array.from(
    new Map(
      standings.map((standing) => [
        getStandingScopeKey(standing),
        {
          id: getStandingScopeKey(standing),
          name: getStandingScopeLabel(standing),
          stageOrder: standing.stage?.order ?? Number.MAX_SAFE_INTEGER,
          itemOrder: standing.stage_item?.order ?? Number.MAX_SAFE_INTEGER
        }
      ])
    ).values()
  ).sort(
    (left, right) =>
      left.stageOrder - right.stageOrder ||
      left.itemOrder - right.itemOrder ||
      left.name.localeCompare(right.name)
  );
}

export function sortStandings(standings: Standings[], sort: StandingSortState): Standings[] {
  if (!sort) return standings;

  const multiplier = sort.dir === "asc" ? 1 : -1;

  return standings.slice().sort((left, right) => {
    let result = 0;

    switch (sort.key) {
      case "position":
        result = left.position - right.position;
        break;
      case "team":
        result = (left.team?.name ?? "").localeCompare(right.team?.name ?? "");
        break;
      case "scope":
        result = getStandingScopeLabel(left).localeCompare(getStandingScopeLabel(right));
        break;
      case "points":
        result = left.points - right.points;
        break;
      case "win":
        result = left.win - right.win;
        break;
      case "draw":
        result = left.draw - right.draw;
        break;
      case "lose":
        result = left.lose - right.lose;
        break;
    }

    return result * multiplier;
  });
}
