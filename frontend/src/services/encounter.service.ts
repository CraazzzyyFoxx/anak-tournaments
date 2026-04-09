import { Encounter, MatchWithStats } from "@/types/encounter.types";
import { PaginatedResponse } from "@/types/pagination.types";
import { apiFetch } from "@/lib/api-fetch";

export default class encounterService {
  static async getEncounter(id: number): Promise<Encounter> {
    return apiFetch("app",`encounters/${id}`, {
      query: {
        entities: [
          "matches",
          "matches.map",
          "teams",
          "teams.players",
          "teams.placement",
          "teams.players.user",
          "tournament",
          "tournament_group"
        ]
      }
    }).then((res) => res.json());
  }
  static async getMatch(match_id: number): Promise<MatchWithStats> {
    return apiFetch("app",`matches/${match_id}`, {
      query: {
        entities: [
          "teams",
          "teams.players",
          "teams.players.user",
          "map",
          "map.gamemode",
          "encounter",
          "encounter.tournament",
          "encounter.tournament_group"
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
    order: "asc" | "desc" = "desc"
  ): Promise<PaginatedResponse<Encounter>> {
    return apiFetch("app",`encounters`, {
      query: {
        per_page: perPage,
        page: page,
        query: query,
        sort: sort ?? "id",
        order: order,
        entities: ["tournament", "tournament_group", "home_team", "away_team"],
        fields: ["name"],
        tournament_id: tournamentId
      }
    }).then((res) => res.json());
  }
  static async getAllMatches(
    page: number,
    perPage: number,
    query: string,
    tournamentId: number | null = null
  ): Promise<PaginatedResponse<MatchWithStats>> {
    return apiFetch("app",`matches`, {
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
          "encounter.tournament_group"
        ],
        tournament_id: tournamentId
      }
    }).then((res) => res.json());
  }
}
