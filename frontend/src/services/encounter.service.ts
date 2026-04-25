import { Encounter, MatchWithStats } from "@/types/encounter.types";
import { PaginatedResponse } from "@/types/pagination.types";
import { apiFetch } from "@/lib/api-fetch";

export default class encounterService {
  static async getEncounter(id: number): Promise<Encounter> {
    return apiFetch("app", `encounters/${id}`, {
      query: {
        entities: [
          "matches",
          "matches.map",
          "teams",
          "teams.players",
          "teams.placement",
          "teams.players.user",
          "tournament",
          "stage",
          "stage_item"
        ]
      }
    }).then((res) => res.json());
  }
  static async getMatch(match_id: number): Promise<MatchWithStats> {
    return apiFetch("app", `matches/${match_id}`, {
      query: {
        entities: [
          "teams",
          "teams.players",
          "teams.players.user",
          "map",
          "map.gamemode",
          "encounter",
          "encounter.tournament",
          "encounter.stage",
          "encounter.stage_item"
        ]
      }
    }).then((res) => res.json());
  }
  static async getAll(
    page: number,
    query: string,
    tournamentId: number | null = null,
    perPage: number = 15,
    sort: string | null = null,
    order: "asc" | "desc" = "desc",
    workspaceId?: number | null
  ): Promise<PaginatedResponse<Encounter>> {
    return apiFetch("app", `encounters`, {
      query: {
        workspace_id: workspaceId,
        per_page: perPage,
        page: page,
        query: query,
        sort: sort ?? "id",
        order: order,
        entities: ["tournament", "stage", "stage_item", "home_team", "away_team"],
        fields: ["name"],
        tournament_id: tournamentId
      }
    }).then((res) => res.json());
  }

  static async getCount(
    tournamentId: number | null = null,
    workspaceId?: number | null
  ): Promise<number> {
    return apiFetch("app", `encounters`, {
      query: {
        workspace_id: workspaceId,
        per_page: 1,
        page: 1,
        only_count: true,
        tournament_id: tournamentId
      }
    })
      .then((res) => res.json())
      .then((response: PaginatedResponse<Encounter>) => response.total);
  }

  static async getAllMatches(
    page: number,
    perPage: number,
    query: string,
    tournamentId: number | null = null
  ): Promise<PaginatedResponse<MatchWithStats>> {
    return apiFetch("app", `matches`, {
      query: {
        per_page: perPage,
        page: page,
        query: query,
        sort: "id",
        order: "desc",
        entities: [
          "teams",
          "map",
          "map.gamemode",
          "encounter",
          "encounter.tournament",
          "encounter.stage",
          "encounter.stage_item"
        ],
        tournament_id: tournamentId
      }
    }).then((res) => res.json());
  }
}
