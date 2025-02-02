import { API_URL } from "@/lib/interceptors";
import { PaginatedResponse } from "@/types/pagination.types";
import { OwalStandings, Standings, Tournament } from "@/types/tournament.types";
import { customFetch } from "@/lib/custom_fetch";
import { TournamentAnalytics } from "@/types/analytics.types";

export default class tournamentService {
  static async getAll(): Promise<PaginatedResponse<Tournament>> {
    return customFetch(`${API_URL}/tournaments`, {
      query: {
        page: 1,
        per_page: -1,
        sort: "id",
        order: "desc",
        entities: ["groups", "participants_count"]
      }
    }).then((response) => response.json());
  }
  static async getOwalStandings(): Promise<OwalStandings> {
    return customFetch(`${API_URL}/tournaments/owal/results`).then((response) => response.json());
  }
  static async get(id: number): Promise<Tournament> {
    return customFetch(`${API_URL}/tournaments/${id}`, {
      query: {
        entities: ["participants_count"]
      }
    }).then((response) => response.json());
  }
  static async getStandings(id: number): Promise<Standings[]> {
    return customFetch(`${API_URL}/tournaments/${id}/standings`, {
      query: {
        entities: ["group", "team", "matches_history", "team.group"]
      }
    }).then((response) => response.json());
  }
  static async getAnalytics(id: number): Promise<TournamentAnalytics> {
    return customFetch(`${API_URL}/tournaments/statistics/analytics`, {
      query: {
        tournament_id: id
      }
    }).then((response) => response.json());
  }
}
