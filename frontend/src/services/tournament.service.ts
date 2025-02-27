import { API_URL } from "@/lib/interceptors";
import { PaginatedResponse } from "@/types/pagination.types";
import { OwalStandings, Standings, Tournament } from "@/types/tournament.types";
import { customFetch } from "@/lib/custom_fetch";
import { PlayerAnalytics, TournamentAnalytics } from "@/types/analytics.types";

export default class tournamentService {
  static async getAll(isLeague: boolean | null = null): Promise<PaginatedResponse<Tournament>> {
    return customFetch(`${API_URL}/tournaments`, {
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
  static async getAnalytics(id: number, algorithm: string): Promise<TournamentAnalytics> {
    return customFetch(`${API_URL}/tournaments/statistics/analytics`, {
      query: {
        tournament_id: id,
        algorithm: algorithm
      }
    }).then((response) => response.json());
  }
  static async patchPlayerShift(
    teamId: number,
    playerId: number,
    shift: number,
    token: string
  ): Promise<PlayerAnalytics> {
    return customFetch(`${API_URL}/tournaments/statistics/analytics/change`, {
      method: "POST",
      body: {
        team_id: teamId,
        player_id: playerId,
        shift: shift
      },
      token: token
    }).then((response) => response.json());
  }
}
