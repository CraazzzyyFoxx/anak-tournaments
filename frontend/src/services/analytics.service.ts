import { PaginatedResponse } from "@/types/pagination.types";
import { customFetch } from "@/lib/custom_fetch";
import { AlgorithmAnalytics, PlayerAnalytics, TournamentAnalytics } from "@/types/analytics.types";

export default class analyticsService {
  static async getAnalytics(id: number, algorithm: string): Promise<TournamentAnalytics> {
    return customFetch(`analytics`, {
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
    return customFetch(`analytics/shift`, {
      method: "POST",
      body: {
        team_id: teamId,
        player_id: playerId,
        shift: shift
      },
      token: token
    }).then((response) => response.json());
  }
  static async getAlgorithms(): Promise<PaginatedResponse<AlgorithmAnalytics>> {
    return customFetch(`analytics/algorithms`, {
      query: {
        page: 1,
        per_page: -1,
        sort: "id",
        order: "desc"
      }
    }).then((response) => response.json());
  }
}
