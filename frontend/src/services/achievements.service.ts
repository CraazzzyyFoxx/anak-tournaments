import { PaginatedResponse } from "@/types/pagination.types";
import { customFetch } from "@/lib/custom_fetch";
import { Achievement, AchievementEarned } from "@/types/achievement.types";

export default class achievementsService {
  static async getAll(page: number, perPage: number): Promise<PaginatedResponse<Achievement>> {
    return customFetch(`achievements`, {
      query: {
        per_page: perPage,
        page: page,
        sort: "rarity",
        order: "asc",
        entities: ["count"]
      }
    }).then((res) => res.json());
  }
  static async getOne(id: number): Promise<Achievement> {
    return customFetch(`achievements/${id}`).then((res) => res.json());
  }
  static async getUsers(
    id: number,
    page: number,
    perPage: number
  ): Promise<PaginatedResponse<AchievementEarned>> {
    return customFetch(`achievements/${id}/users`, {
      query: {
        per_page: perPage,
        page: page
      }
    }).then((res) => res.json());
  }
}
