import { PaginatedResponse } from "@/types/pagination.types";
import { OwalStandings, Standings, Tournament } from "@/types/tournament.types";
import { customFetch } from "@/lib/custom_fetch";
import { PlayerAnalytics, TournamentAnalytics } from "@/types/analytics.types";

export default class tournamentService {
  static async getAll(isLeague: boolean | null = null): Promise<PaginatedResponse<Tournament>> {
    return customFetch(`tournaments`, {
      query: {
        is_league: isLeague,
        page: 1,
        per_page: -1,
        sort: "id",
        order: "desc",
        entities: ["groups", "participants_count"]
      }
    }).then((response) => response.json());
  }
  static async getOwalStandings(): Promise<OwalStandings> {
    return customFetch(`tournaments/owal/results`).then((response) => response.json());
  }
  static async get(id: number): Promise<Tournament> {
    return customFetch(`tournaments/${id}`, {
      query: {
        entities: ["participants_count"]
      }
    }).then((response) => response.json());
  }
  static async getStandings(id: number): Promise<Standings[]> {
    return customFetch(`tournaments/${id}/standings`, {
      query: {
        entities: ["group", "team", "matches_history", "team.group"]
      }
    }).then((response) => response.json());
  }
}
