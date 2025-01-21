import { API_URL } from "@/lib/interceptors";
import { HeroPlaytime } from "@/types/hero.types";
import { PaginatedResponse } from "@/types/pagination.types";
import { customFetch } from "@/lib/custom_fetch";

export default class heroService {
  static async getHeroPlaytime(
    page: number = 1,
    perPage: number = 10,
    userId: number | string = "all",
    tournamentId: number | null = null
  ): Promise<PaginatedResponse<HeroPlaytime>> {
    return customFetch(`${API_URL}/heroes/statistics/playtime`, {
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
