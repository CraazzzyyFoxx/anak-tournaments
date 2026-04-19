import { PaginatedResponse } from "@/types/pagination.types";
import { apiFetch } from "@/lib/api-fetch";
import {
  AlgorithmAnalytics,
  AnalyticsRecalculateResponse,
  PlayerAnalytics,
  TournamentAnalytics
} from "@/types/analytics.types";

export default class analyticsService {
  static async getAnalytics(
    id: number,
    algorithm: number,
    workspaceId?: number | null,
  ): Promise<TournamentAnalytics> {
    return apiFetch("app",`analytics`, {
      query: {
        tournament_id: id,
        algorithm: algorithm,
        workspace_id: workspaceId,
      }
    }).then((response) => response.json());
  }
  static async patchPlayerShift(
    teamId: number,
    playerId: number,
    shift: number
  ): Promise<PlayerAnalytics> {
    return apiFetch("app",`analytics/shift`, {
      method: "POST",
      body: {
        team_id: teamId,
        player_id: playerId,
        shift: shift
      }
    }).then((response) => response.json());
  }
  static async getAlgorithms(): Promise<PaginatedResponse<AlgorithmAnalytics>> {
    return apiFetch("app",`analytics/algorithms`, {
      query: {
        page: 1,
        per_page: -1,
        sort: "id",
        order: "desc"
      }
    }).then((response) => response.json());
  }

  static async recalculateAnalytics(
    tournamentId: number,
    algorithmIds?: number[],
    workspaceId?: number | null,
  ): Promise<AnalyticsRecalculateResponse> {
    return apiFetch("parser", "analytics/recalculate", {
      query: {
        workspace_id: workspaceId,
      },
      method: "POST",
      body: {
        tournament_id: tournamentId,
        ...(algorithmIds?.length ? { algorithm_ids: algorithmIds } : {})
      }
    }).then((response) => response.json());
  }
}
