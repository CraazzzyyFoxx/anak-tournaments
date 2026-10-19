import {
  CharacterLeaderboardEntry,
  TournamentDivisionStatistics,
  TournamentStatistics,
  TournamentOverall,
  PlayerStatistics
} from "@/types/statistics.types";
import type { CharacterPlaytime } from "@/types/user.types";
import { apiFetch } from "@/lib/api/fetch";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import { PaginatedResponse } from "@/types/pagination.types";

// Platform aggregates (totals, champions, win rates, per-tournament history)
// move when a tournament or a parsed log lands, not per request. Server-side
// reads are held in the Next Data Cache for this long (seconds), so a homepage
// or /statistics render that misses the nginx cache costs a React render, not
// a gateway round-trip per section. Every route here is edge.AuthNone (the
// gateway forwards no identity), so the body is the same for every viewer:
// skipAuth keeps Authorization out of the request and out of the Data Cache
// key, leaving one entry per URL (workspace_id). With the bearer in the key, a
// forged session cookie minted a fresh entry on every render. Client
// (react-query) fetches ignore the `next` option.
const STATS_TTL_SECONDS = 60;

interface StatsOpts {
  workspaceId?: number | "all";
  skipWorkspace?: boolean;
}

function buildWorkspaceOpts(opts?: StatsOpts) {
  return {
    skipWorkspace: opts?.skipWorkspace,
    skipAuth: true,
    query: opts?.workspaceId != null ? { workspace_id: opts.workspaceId } : undefined,
    next: { revalidate: STATS_TTL_SECONDS },
  };
}

/** A one-game leaderboard (`/statistics/{champion,winrate,won-maps}`): the game is always explicit, never defaulted. */
function playerLeaderboard(
  path: string,
  discipline: string,
  opts?: StatsOpts
): Promise<PaginatedResponse<PlayerStatistics>> {
  const base = buildWorkspaceOpts(opts);
  return apiFetch(path, {
    ...base,
    query: { ...base.query, discipline, sort: "value", order: "desc" },
  }).then((res) => res.json());
}

export default class statisticsService {
  static async getTournaments(opts?: StatsOpts): Promise<TournamentStatistics[]> {
    return apiFetch("/api/v1/tournaments/statistics/history", buildWorkspaceOpts(opts)).then(
      (res) => res.json()
    );
  }

  static async getTournamentsDivision(opts?: StatsOpts): Promise<TournamentDivisionStatistics[]> {
    return apiFetch("/api/v1/tournaments/statistics/division", buildWorkspaceOpts(opts)).then(
      (res) => res.json()
    );
  }

  static async getOverallStatistics(opts?: StatsOpts): Promise<TournamentOverall> {
    return apiFetch("/api/v1/tournaments/statistics/overall", buildWorkspaceOpts(opts)).then(
      (res) => res.json()
    );
  }

  static async getChampions(discipline: string, opts?: StatsOpts): Promise<PaginatedResponse<PlayerStatistics>> {
    return playerLeaderboard("/api/v1/statistics/champion", discipline, opts);
  }

  static async getTopWinratePlayers(
    discipline: string,
    opts?: StatsOpts
  ): Promise<PaginatedResponse<PlayerStatistics>> {
    return playerLeaderboard("/api/v1/statistics/winrate", discipline, opts);
  }

  static async getTopWonMapsPlayers(
    discipline: string,
    opts?: StatsOpts
  ): Promise<PaginatedResponse<PlayerStatistics>> {
    return playerLeaderboard("/api/v1/statistics/won-maps", discipline, opts);
  }

  /** One game's characters by share of observed playtime, most played first. */
  static async getCharacterPlaytime(
    discipline: string,
    {
      axis,
      page = 1,
      perPage = 10,
      userId = "all",
      tournamentId = null,
      signal
    }: {
      axis: WorkspaceAxis;
      page?: number;
      perPage?: number;
      userId?: number | "all";
      tournamentId?: number | null;
      signal?: AbortSignal;
    }
  ): Promise<PaginatedResponse<CharacterPlaytime>> {
    return apiFetch(`/api/v1/statistics/${encodeURIComponent(discipline)}/characters/playtime`, {
      signal,
      skipAuth: true,
      query: {
        page,
        per_page: perPage,
        user_id: userId,
        tournament_id: tournamentId ?? undefined,
        sort: "playtime",
        order: "desc",
        workspace_id: axis,
      },
      next: { revalidate: STATS_TTL_SECONDS },
    }).then((res) => res.json());
  }

  /** One character's player leaderboard; a character of another game is a 404. */
  static async getCharacterLeaderboard(
    discipline: string,
    entityId: number,
    {
      axis,
      stat,
      tournamentId,
      page = 1,
      perPage = 50,
      signal
    }: {
      axis: WorkspaceAxis;
      /** The ordering stat; absent = the server's default ranking. */
      stat?: string;
      tournamentId?: number | null;
      page?: number;
      perPage?: number;
      signal?: AbortSignal;
    }
  ): Promise<PaginatedResponse<CharacterLeaderboardEntry>> {
    return apiFetch(
      `/api/v1/statistics/${encodeURIComponent(discipline)}/characters/${entityId}/leaderboard`,
      {
        signal,
        query: {
          tournament_id: tournamentId ?? undefined,
          stat,
          page,
          per_page: perPage,
          workspace_id: axis,
        },
      }
    ).then((res) => res.json());
  }
}
