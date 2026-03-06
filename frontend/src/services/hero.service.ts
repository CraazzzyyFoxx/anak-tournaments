import { Hero, HeroPlaytime } from "@/types/hero.types";
import { PaginatedResponse } from "@/types/pagination.types";
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
}
