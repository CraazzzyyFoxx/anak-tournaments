import { Hero, HeroLeaderboardEntry, HeroPlaytime } from "@/types/hero.types";
import { PaginatedResponse } from "@/types/pagination.types";
import { LogStatsName } from "@/types/stats.types";
import { customFetch } from "@/lib/custom_fetch";

export default class heroService {
  static async getAll({
    page = 1,
    perPage = -1,
    sort = "name",
    order = "asc",
    query
  }: {
    page?: number;
    perPage?: number;
    sort?: "id" | "name" | "slug";
    order?: "asc" | "desc";
    query?: string;
  } = {}): Promise<PaginatedResponse<Hero>> {
    return customFetch("heroes", {
      query: {
        page,
        per_page: perPage,
        sort,
        order,
        query,
        fields: ["name"]
      }
    }).then((res) => res.json());
  }

  static async getHeroPlaytime(
    page: number = 1,
    perPage: number = 10,
    userId: number | string = "all",
    tournamentId: number | null = null
  ): Promise<PaginatedResponse<HeroPlaytime>> {
    return customFetch(`heroes/statistics/playtime`, {
      query: {
        page: page,
        per_page: perPage,
        user_id: userId,
        tournament_id: tournamentId,
        sort: "playtime",
        order: "desc"
      }
    }).then((res) => res.json());
  }

  static async getHeroLeaderboard(
    heroId: number,
    {
      tournamentId,
      stat = LogStatsName.Performance,
      page = 1,
      perPage = 50
    }: {
      tournamentId?: number | null;
      stat?: LogStatsName;
      page?: number;
      perPage?: number;
    } = {}
  ): Promise<PaginatedResponse<HeroLeaderboardEntry>> {
    return customFetch(`heroes/${heroId}/leaderboard`, {
      query: {
        tournament_id: tournamentId ?? undefined,
        stat,
        page,
        per_page: perPage
      }
    }).then((res) => res.json());
  }
}
