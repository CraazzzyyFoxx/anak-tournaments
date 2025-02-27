import {
  TournamentDivisionStatistics,
  TournamentStatistics,
  TournamentOverall,
  PlayerStatistics
} from "@/types/statistics.types";
import { customFetch } from "@/lib/custom_fetch";
import { PaginatedResponse } from "@/types/pagination.types";

export default class statisticsService {
  static async getTournaments(): Promise<TournamentStatistics[]> {
    return customFetch(`tournaments/statistics/history`).then((res) => res.json());
  }
  static async getTournamentsDivision(): Promise<TournamentDivisionStatistics[]> {
    return customFetch(`tournaments/statistics/division`).then((res) => res.json());
  }
  static async getOverallStatistics(): Promise<TournamentOverall> {
    return customFetch(`tournaments/statistics/overall`).then((res) => res.json());
  }
  static async getChampions(): Promise<PaginatedResponse<PlayerStatistics>> {
    return customFetch(`statistics/champion`, {
      query: {
        sort: "value",
        order: "desc"
      }
    }).then((res) => res.json());
  }
  static async getTopWinratePlayers(): Promise<PaginatedResponse<PlayerStatistics>> {
    return customFetch(`statistics/winrate`, {
      query: {
        sort: "value",
        order: "desc"
      }
    }).then((res) => res.json());
  }
}
