import encounterService from "@/services/encounter.service";
import { resolveStatsScope } from "@/lib/site/tenant-host";
import { resolveServerPageGame } from "@/lib/site/discipline-server";
import type { StatsScope } from "@/lib/site/stats-scope";
import EncountersClient from "./_components/EncountersClient";
import type { EncountersSeed } from "./_components/useEncountersData";
import {
  aggregateFilters,
  ENCOUNTERS_PAGE_SIZE,
  GAME_SCOPED_FILTERS,
  listReadArgs,
  readEncountersUrl,
  type EncountersUrlState
} from "./_components/encounters.helpers";

type EncountersPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

/**
 * The first paint's reads: the list (in the list view), the global overview the hero shows and, when the URL
 * narrows anything, the overview the toolbar counts. A failure seeds nothing: the browser reads again, and a
 * failure there is the list's one error card.
 */
async function readSeed(
  url: EncountersUrlState,
  scope: StatsScope,
  discipline: string | null
): Promise<EncountersSeed | null> {
  // Workspace scope leaves the ambient workspace to `apiFetch`.
  const workspaceId = scope === "all" ? "all" : undefined;
  const read = listReadArgs(url.filters, url.page);
  const counted = aggregateFilters(url.filters);
  const narrowed = url.filters.query !== "" || Object.keys(counted).length > 0;
  try {
    const [data, overview, counts] = await Promise.all([
      url.view === "list"
        ? encounterService.getAll(
            read.page,
            read.query,
            null,
            ENCOUNTERS_PAGE_SIZE,
            read.sort,
            read.order,
            workspaceId,
            { ...read.filters, discipline }
          )
        : null,
      encounterService.getOverview("", { discipline }, workspaceId),
      narrowed ? encounterService.getOverview(url.filters.query, { ...counted, discipline }, workspaceId) : null
    ]);
    return { discipline, data, overview, counts: counts ?? overview };
  } catch {
    return null;
  }
}

export default async function EncountersPage({ searchParams }: Readonly<EncountersPageProps>) {
  const raw = await searchParams;
  const url = readEncountersUrl(raw);
  const [scope, browsing] = await Promise.all([resolveStatsScope(), resolveServerPageGame("multi", raw.discipline)]);
  const game = browsing.resolution?.game;
  // Under every game one game's tournament/stage never narrows a read (spec §6.2), the URL's included.
  const initialUrl = game?.kind === "all" ? { ...url, filters: { ...url.filters, ...GAME_SCOPED_FILTERS } } : url;
  const discipline = game?.kind === "game" ? game.code : null;
  const seed = game?.kind === "all" || game?.kind === "game" ? await readSeed(initialUrl, scope, discipline) : null;

  return <EncountersClient seed={seed} initial={browsing.init} initialUrl={initialUrl} scope={scope} />;
}
