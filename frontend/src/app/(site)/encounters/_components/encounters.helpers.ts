import type { Formatter } from "@/lib/datetime";
import type {
  EncounterFilters,
  EncounterOverview,
  EncounterSavedFilters,
  EncounterStatusFilter
} from "@/types/encounter.types";

export const ENCOUNTERS_PAGE_SIZE = 15;

/** A status segment; `null` is «Все». */
export type EncounterStatus = Extract<EncounterStatusFilter, "live" | "upcoming" | "completed">;

export type EncountersView = "list" | "insights";

export interface EncounterFilterState {
  query: string;
  tournament_id: number | null;
  stage_id: number | null;
  stage_item_id: number | null;
  best_of: number | null;
  status: EncounterStatus | null;
  /** The quick filters narrow or stay out of the way: `null` is off, never `false`. */
  has_logs: true | null;
  is_final: true | null;
  is_upset: true | null;
  closeness_min: number | null;
  closeness_max: number | null;
  scope: "all" | "my_team";
  sort: "date" | "closeness";
}

export const DEFAULT_FILTERS: EncounterFilterState = {
  query: "",
  tournament_id: null,
  stage_id: null,
  stage_item_id: null,
  best_of: null,
  status: null,
  has_logs: null,
  is_final: null,
  is_upset: null,
  closeness_min: null,
  closeness_max: null,
  scope: "all",
  sort: "date"
};

/**
 * The filters that name one game's tournament or stage, cleared when the game changes so the
 * new game's list is not narrowed to an id it cannot contain. Field names double as URL params.
 */
export const GAME_SCOPED_FILTERS = {
  tournament_id: null,
  stage_id: null,
  stage_item_id: null
} as const satisfies Partial<EncounterFilterState>;

export type QuickFilterId = keyof Pick<EncounterOverview["counts"], "finals" | "upsets" | "with_logs" | "my_team">;

/** The «Подборки» toggles, in menu order: each narrows the current filters (additive) and has its overview count. */
export const QUICK_FILTERS = [
  {
    id: "finals",
    label: "encounters.presets.finals",
    isOn: (filters: EncounterFilterState) => filters.is_final === true,
    patch: (on: boolean): Partial<EncounterFilterState> => ({ is_final: on ? true : null })
  },
  {
    id: "upsets",
    label: "encounters.presets.upsets",
    isOn: (filters: EncounterFilterState) => filters.is_upset === true,
    patch: (on: boolean): Partial<EncounterFilterState> => ({ is_upset: on ? true : null })
  },
  {
    id: "with_logs",
    label: "encounters.presets.withLogs",
    isOn: (filters: EncounterFilterState) => filters.has_logs === true,
    patch: (on: boolean): Partial<EncounterFilterState> => ({ has_logs: on ? true : null })
  },
  {
    id: "my_team",
    label: "encounters.presets.myTeam",
    isOn: (filters: EncounterFilterState) => filters.scope === "my_team",
    patch: (on: boolean): Partial<EncounterFilterState> => ({ scope: on ? "my_team" : "all" })
  }
] as const satisfies readonly {
  id: QuickFilterId;
  label: string;
  isOn: (filters: EncounterFilterState) => boolean;
  patch: (on: boolean) => Partial<EncounterFilterState>;
}[];

/** The «Напряжённость» select's lower bounds. */
export const CLOSENESS_STEPS = [0.4, 0.6, 0.8] as const;

function numberParam(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusParam(params: Record<string, string | undefined>): EncounterStatus | null {
  const { status } = params;
  if (status === "live" || status === "upcoming" || status === "completed") return status;
  // `open`/`pending` were two chips, and «Ближайшие» a sort, before both became the «Предстоят» segment.
  if (status === "open" || status === "pending" || params.sort === "upcoming") return "upcoming";
  return null;
}

/** The filter state a URL (or a saved view's filters, as strings) names; anything unknown is ignored. */
export function normalizeEncounterFilters(params: Record<string, string | undefined>): EncounterFilterState {
  return {
    query: params.search ?? params.query ?? "",
    tournament_id: numberParam(params.tournament_id),
    stage_id: numberParam(params.stage_id),
    stage_item_id: numberParam(params.stage_item_id),
    best_of: numberParam(params.best_of),
    status: statusParam(params),
    has_logs: params.has_logs === "true" || null,
    is_final: params.is_final === "true" || null,
    is_upset: params.is_upset === "true" || null,
    closeness_min: numberParam(params.closeness_min),
    closeness_max: numberParam(params.closeness_max),
    scope: params.scope === "my_team" ? "my_team" : "all",
    sort: params.sort === "closeness" ? "closeness" : "date"
  };
}

/** What the page's URL says: the list page (a positive integer, else the first), the view and the filters. */
export interface EncountersUrlState {
  page: number;
  view: EncountersView;
  filters: EncounterFilterState;
}

export function readEncountersUrl(params: Record<string, string | undefined>): EncountersUrlState {
  const page = Number.parseInt(params.page ?? "", 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    view: params.view === "insights" ? "insights" : "list",
    filters: normalizeEncounterFilters(params)
  };
}

export function filtersToSearchParams(filters: EncounterFilterState, page: number, view: EncountersView): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query) params.set("search", filters.query);
  if (page > 1) params.set("page", String(page));
  if (filters.tournament_id != null) params.set("tournament_id", String(filters.tournament_id));
  if (filters.stage_id != null) params.set("stage_id", String(filters.stage_id));
  if (filters.stage_item_id != null) params.set("stage_item_id", String(filters.stage_item_id));
  if (filters.best_of != null) params.set("best_of", String(filters.best_of));
  if (filters.status) params.set("status", filters.status);
  if (filters.has_logs) params.set("has_logs", "true");
  if (filters.is_final) params.set("is_final", "true");
  if (filters.is_upset) params.set("is_upset", "true");
  if (filters.closeness_min != null) params.set("closeness_min", String(filters.closeness_min));
  if (filters.closeness_max != null) params.set("closeness_max", String(filters.closeness_max));
  if (filters.scope !== "all") params.set("scope", filters.scope);
  if (filters.sort !== "date") params.set("sort", filters.sort);
  if (view !== "list") params.set("view", view);
  return params;
}

const API_SORT = {
  date: { sort: "played_at", order: "desc" },
  closeness: { sort: "closeness", order: "desc" }
} as const;

export function filtersToApiFilters(
  filters: EncounterFilterState
): EncounterFilters & { sort: string; order: "asc" | "desc" } {
  return {
    tournament_id: filters.tournament_id,
    stage_id: filters.stage_id,
    stage_item_id: filters.stage_item_id,
    best_of: filters.best_of,
    status: filters.status,
    has_logs: filters.has_logs,
    is_final: filters.is_final,
    is_upset: filters.is_upset,
    closeness_min: filters.closeness_min,
    closeness_max: filters.closeness_max,
    scope: filters.scope,
    // «Предстоят» always reads soonest first; the sort select speaks for the other segments.
    ...(filters.status === "upcoming" ? { sort: "scheduled_at", order: "asc" } : API_SORT[filters.sort])
  };
}

const LIST_ENTITIES = ["tournament", "stage", "stage_item", "teams", "matches", "matches.map"];

/** The list read's arguments, shared by the server render and the browser so both make the same request. */
export function listReadArgs(filters: EncounterFilterState, page: number) {
  const { sort, order, ...narrowing } = filtersToApiFilters(filters);
  return { page, query: filters.query, sort, order, filters: { ...narrowing, entities: LIST_ENTITIES } };
}

/**
 * The aggregate reads' filter params: the list's without its order, and only what narrows — so "no filters" is the
 * same request (and cache entry) as the hero's global overview.
 */
export function aggregateFilters(filters: EncounterFilterState): EncounterFilters {
  const { sort: _sort, order: _order, ...narrowing } = filtersToApiFilters(filters);
  return Object.fromEntries(
    Object.entries(narrowing).filter(([key, value]) => value != null && !(key === "scope" && value === "all"))
  ) as EncounterFilters;
}

/** A saved view's filters as this page's state, read the way a URL is: an old view's `sort=upcoming` included. */
export function savedViewState(filters: EncounterSavedFilters): EncounterFilterState {
  return normalizeEncounterFilters(
    Object.fromEntries(Object.entries(filters).flatMap(([key, value]) => (value == null ? [] : [[key, String(value)]])))
  );
}

export function sameFilters(a: EncounterFilterState, b: EncounterFilterState): boolean {
  return (Object.keys(DEFAULT_FILTERS) as (keyof EncounterFilterState)[]).every((key) => a[key] === b[key]);
}

/** True once anything narrows the list, status included: the empty list then offers to clear them. */
export function hasActiveFilters(filters: EncounterFilterState): boolean {
  return !sameFilters({ ...filters, sort: DEFAULT_FILTERS.sort }, DEFAULT_FILTERS);
}

/** Only `number` is needed here; `useFormatter()` and `await getFormatter()` both satisfy it. */
export type NumberFormatter = Pick<Formatter, "number">;

export function formatPercent(format: NumberFormatter, fraction: number): string {
  return format.number(fraction, { style: "percent", maximumFractionDigits: 0 });
}

/** A series length in the locale's own units: minutes under an hour, hours to one decimal past it. */
export function formatSeriesLength(format: NumberFormatter, seconds: number): string {
  return seconds < 3600
    ? format.number(seconds / 60, { style: "unit", unit: "minute", unitDisplay: "short", maximumFractionDigits: 0 })
    : format.number(seconds / 3600, { style: "unit", unit: "hour", unitDisplay: "short", maximumFractionDigits: 1 });
}
