import {
  TournamentDivisionStatistics,
  TournamentStatistics,
  TournamentOverall,
  PlayerStatistics
} from "@/types/statistics.types";
import { apiFetch } from "@/lib/api-fetch";
import { PaginatedResponse } from "@/types/pagination.types";

export default class statisticsService {
  static async getTournaments(): Promise<TournamentStatistics[]> {
    return apiFetch("app",`tournaments/statistics/history`).then((res) => res.json());
  }
  static async getTournamentsDivision(): Promise<TournamentDivisionStatistics[]> {
    return apiFetch("app",`tournaments/statistics/division`).then((res) => res.json());
  }
  static async getOverallStatistics(): Promise<TournamentOverall> {
    return apiFetch("app",`tournaments/statistics/overall`).then((res) => res.json());
  }
  static async getChampions(): Promise<PaginatedResponse<PlayerStatistics>> {
    return apiFetch("app",`statistics/champion`, {
      query: {
        sort: "value",
        order: "desc"
      }
    }).then((res) => res.json());
  }
  static async getTopWinratePlayers(): Promise<PaginatedResponse<PlayerStatistics>> {
    return apiFetch("app",`statistics/winrate`, {
      query: {
        sort: "value",
        order: "desc"
      }
    }).then((res) => res.json());
  }
}
