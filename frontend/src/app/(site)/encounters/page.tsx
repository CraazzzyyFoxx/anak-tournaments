import { getTranslations } from "next-intl/server";
import encounterService from "@/services/encounter.service";
import type { Encounter } from "@/types/encounter.types";
import type { PaginatedResponse } from "@/types/pagination.types";
import { resolveStatsScope } from "@/lib/site/tenant-host";
import { resolveServerPageGame } from "@/lib/site/discipline-server";
import type { GameScopeInit } from "@/lib/site/discipline-scope";
import type { StatsScope } from "@/lib/site/stats-scope";
import EncountersClient from "./_components/EncountersClient";
import type { EncountersSeed } from "./_components/useEncountersData";
import {
  EMPTY_OVERVIEW,
  ENCOUNTERS_PAGE_SIZE,
  filtersToApiFilters,
  GAME_SCOPED_FILTERS,
  normalizeEncounterFilters,
  parsePageParam,
  type EncounterFilterState,
} from "./_components/encounters.helpers";

function emptyEncounters(page: number): PaginatedResponse<Encounter> {
  return {
    page,
    per_page: ENCOUNTERS_PAGE_SIZE,
    total: 0,
    results: [],
  };
}

type EncountersPageProps = {
  searchParams: Promise<{
    page?: string;
    search?: string;
    query?: string;
    stage_id?: string;
    stage_item_id?: string;
    best_of?: string;
    status?: string;
    has_logs?: string;
    closeness_min?: string;
    closeness_max?: string;
    scope?: string;
    sort?: string;
    discipline?: string;
  }>;
};

type ParsedSearchParams = {
  page: number;
  filters: EncounterFilterState;
};

type EncountersContentProps = ParsedSearchParams & {
  scope: StatsScope;
  initial: GameScopeInit;
  /** The game resolved to every game or one game; invalid, empty or unreadable reads nothing. */
  read: boolean;
  /** The page's game; `null` is every game. */
  game: string | null;
};

function parseSearchParams(params: Record<string, string | undefined>): ParsedSearchParams {
  return {
    page: parsePageParam(params.page),
    filters: normalizeEncounterFilters(params),
  };
}

async function EncountersContent({ page, filters, scope, initial, read, game }: Readonly<EncountersContentProps>) {
  const t = await getTranslations();
  const apiFilters = { ...filtersToApiFilters(filters), discipline: game };
  let initialError: string | null = null;
  // Workspace scope leaves the ambient workspace to `apiFetch`.
  const workspaceId = scope === "all" ? "all" : undefined;
  let seed: EncountersSeed | null = null;

  if (read) {
    seed = { discipline: game, data: emptyEncounters(page), overview: EMPTY_OVERVIEW };
    try {
      [seed.data, seed.overview] = await Promise.all([
        encounterService.getAll(
          page,
          filters.query,
          null,
          ENCOUNTERS_PAGE_SIZE,
          apiFilters.sort,
          apiFilters.order,
          workspaceId,
          {
            ...apiFilters,
            entities: [
              "tournament",
              "stage",
              "stage_item",
              "teams",
              "matches",
              "matches.map",
            ],
          },
        ),
        encounterService.getOverview(filters.query, apiFilters, workspaceId),
      ]);
    } catch {
      initialError = t("encounters.dataUnavailable");
    }
  }

  return (
    <EncountersClient
      seed={seed}
      initial={initial}
      initialFilters={filters}
      initialPage={page}
      initialError={initialError}
      scope={scope}
    />
  );
}

export default async function EncountersPage({ searchParams }: Readonly<EncountersPageProps>) {
  const raw = await searchParams;
  const params = parseSearchParams(raw);
  const [scope, browsing] = await Promise.all([
    resolveStatsScope(),
    resolveServerPageGame("multi", raw.discipline),
  ]);
  const game = browsing.resolution?.game;
  // Under every game one game's tournament/stage never narrows a read (spec §6.2), the URL's included.
  const filters = game?.kind === "all" ? { ...params.filters, ...GAME_SCOPED_FILTERS } : params.filters;

  return (
    <EncountersContent
      page={params.page}
      filters={filters}
      scope={scope}
      initial={browsing.init}
      read={game?.kind === "all" || game?.kind === "game"}
      game={game?.kind === "game" ? game.code : null}
    />
  );
}
