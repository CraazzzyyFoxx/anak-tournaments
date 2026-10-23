import { apiFetch } from "@/lib/api/fetch";
import { CurrentRanksResponse, RankHistoryQuery, RankHistoryResponse } from "@/types/rank.types";

function historyQuery(params: RankHistoryQuery) {
  return {
    discipline: params.discipline,
    platform: params.platform,
    role: params.role,
    social_account_id: params.socialAccountId,
    date_from: params.dateFrom,
    date_to: params.dateTo,
    granularity: params.granularity ?? "raw"
  };
}

export default class rankService {
  static async getUserRankHistory(userId: number, params: RankHistoryQuery): Promise<RankHistoryResponse> {
    return apiFetch(`/api/v1/users/${userId}/rank-history`, {
      query: historyQuery(params),
      skipWorkspace: true
    }).then((res) => res.json());
  }

  static async getUserCurrentRanks(
    userId: number,
    discipline: string,
    platform?: "pc" | "console"
  ): Promise<CurrentRanksResponse> {
    return apiFetch(`/api/v1/users/${userId}/current-ranks`, {
      query: { discipline, platform },
      skipWorkspace: true
    }).then((res) => res.json());
  }
}
