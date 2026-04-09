import { LookupItem, PaginatedResponse } from "@/types/pagination.types";
import { OwalStack, OwalStandings, Standings, Tournament } from "@/types/tournament.types";
import { apiFetch } from "@/lib/api-fetch";
import { PlayerAnalytics, TournamentAnalytics } from "@/types/analytics.types";
import { normalizePaginatedResponse } from "@/lib/normalize-paginated-response";

export default class tournamentService {
  static async lookup(
    workspaceId?: number | null,
    isLeague?: boolean | null
  ): Promise<LookupItem[]> {
    return apiFetch("app", "tournaments/lookup", {
      query: {
        workspace_id: workspaceId,
        is_league: isLeague,
      },
    }).then((res) => res.json());
  }

  static async getAll(
    isLeague: boolean | null = null,
    workspaceId?: number | null
  ): Promise<PaginatedResponse<Tournament>> {
    return apiFetch("app",`tournaments`, {
      query: {
        is_league: isLeague,
        workspace_id: workspaceId,
        page: 1,
        per_page: -1,
        sort: "id",
        order: "desc",
        entities: ["groups", "participants_count"],
      },
    })
      .then((response) => response.json())
      .then((response: PaginatedResponse<Tournament>) =>
        normalizePaginatedResponse(response)
      );
  }
  static async getOwalSeasons(workspaceId?: number | null): Promise<string[]> {
    return apiFetch("app",`tournaments/league/seasons`, {
      query: { workspace_id: workspaceId },
    }).then((response) => response.json());
  }

  static async getOwalStandings(
    season?: string,
    workspaceId?: number | null
  ): Promise<OwalStandings> {
    return apiFetch("app",`tournaments/league/results`, {
      query: {
        season,
        workspace_id: workspaceId,
      },
    }).then((response) => response.json());
  }

  static async getOwalStacks(
    season?: string,
    workspaceId?: number | null
  ): Promise<OwalStack[]> {
    return apiFetch("app",`tournaments/league/stacks`, {
      query: {
        season,
        workspace_id: workspaceId,
      },
    }).then((response) => response.json());
  }
  static async getActive(): Promise<PaginatedResponse<Tournament>> {
    return apiFetch("app", `tournaments`, {
      query: {
        page: 1,
        per_page: -1,
        sort: "id",
        order: "desc",
        entities: ["registrations_count"],
      },
    })
      .then((response) => response.json())
      .then((response: PaginatedResponse<Tournament>) =>
        normalizePaginatedResponse(response)
      );
  }

  static async get(id: number): Promise<Tournament> {
    return apiFetch("app",`tournaments/${id}`, {
      query: {
        entities: ["participants_count", "groups"],
      },
    }).then((response) => response.json());
  }
  static async getStandings(id: number): Promise<Standings[]> {
    return apiFetch("app",`tournaments/${id}/standings`, {
      query: {
        entities: ["group", "team", "matches_history", "team.group"],
      },
    }).then((response) => response.json());
  }
}
