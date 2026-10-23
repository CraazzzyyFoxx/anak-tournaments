import { PaginatedResponse } from "@/types/pagination.types";
import { apiFetch } from "@/lib/api/fetch";
import { Achievement, AchievementEarned } from "@/types/achievement.types";
import { scopeQuery, type StatsScope } from "@/lib/site/stats-scope";

export default class achievementsService {
  /**
   * `workspaceId` may be `"all"` — every workspace (platform apex only).
   * `discipline` narrows the list to one game; omitted, every game's rules are listed.
   */
  static async getAll(
    page: number,
    perPage: number,
    workspaceId?: number | "all" | null,
    discipline?: string | null,
    opts: { signal?: AbortSignal } = {}
  ): Promise<PaginatedResponse<Achievement>> {
    return apiFetch(`/api/v1/achievements`, {
      signal: opts.signal,
      query: {
        per_page: perPage,
        page: page,
        sort: "rarity",
        order: "asc",
        entities: ["count"],
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        ...(discipline ? { discipline } : {}),
      }
    }).then((res) => res.json());
  }
  static async getOne(id: number, scope?: StatsScope): Promise<Achievement> {
    return apiFetch(`/api/v1/achievements/${id}`, {
      query: { entities: ["count"], ...scopeQuery(scope) }
    }).then((res) => res.json());
  }
  static async getUsers(
    id: number,
    page: number,
    perPage: number,
    scope?: StatsScope
  ): Promise<PaginatedResponse<AchievementEarned>> {
    return apiFetch(`/api/v1/achievements/${id}/users`, {
      query: {
        per_page: perPage,
        page: page,
        ...scopeQuery(scope)
      }
    }).then((res) => res.json());
  }
}
