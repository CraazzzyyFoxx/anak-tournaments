import tournamentService from "@/services/tournament.service";
import { OwalStack, OwalStandings } from "@/types/tournament.types";

export type OwalPageSearchParams = {
  season?: string;
};

export type OwalPageData = {
  seasons: string[];
  selectedSeason: string | undefined;
  standings: OwalStandings;
  stacks: OwalStack[];
};

const EMPTY_STANDINGS: OwalStandings = { days: [], standings: [] };
const EMPTY_STACKS: OwalStack[] = [];

/** Falls back to the newest season whenever the requested one does not exist. */
const resolveSeason = (requestedSeason: string | undefined, seasons: string[]) => {
  if (!requestedSeason || seasons.length === 0) return seasons[0];
  return seasons.includes(requestedSeason) ? requestedSeason : seasons[0];
};

export const getOwalPageData = async (
  searchParamsPromise: Promise<OwalPageSearchParams>
): Promise<OwalPageData> => {
  const [searchParams, seasons] = await Promise.all([
    searchParamsPromise,
    tournamentService.getOwalSeasons()
  ]);

  const selectedSeason = resolveSeason(searchParams.season, seasons);

  if (!selectedSeason) {
    return {
      seasons,
      selectedSeason,
      standings: EMPTY_STANDINGS,
      stacks: EMPTY_STACKS
    };
  }

  const [standings, stacks] = await Promise.all([
    tournamentService.getOwalStandings(selectedSeason),
    tournamentService.getOwalStacks(selectedSeason)
  ]);

  return {
    seasons,
    selectedSeason,
    standings,
    stacks
  };
};
