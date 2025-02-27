import { Encounter, MatchWithStats } from "@/types/encounter.types";
import { PaginatedResponse } from "@/types/pagination.types";
import { customFetch } from "@/lib/custom_fetch";

export default class encounterService {
  static async getEncounter(id: number): Promise<Encounter> {
    return customFetch(`encounters/${id}`, {
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
    return customFetch(`matches/${match_id}`, {
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
    tournamentId: number | null = null
  ): Promise<PaginatedResponse<Encounter>> {
    return customFetch(`encounters`, {
      query: {
        per_page: 15,
        page: page,
        query: query,
        sort: "id",
        order: "desc",
        entities: ["tournament", "tournament_group"],
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
    return customFetch(`matches`, {
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
