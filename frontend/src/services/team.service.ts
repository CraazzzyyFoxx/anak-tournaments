import { API_URL } from "@/lib/interceptors";
import { PaginatedResponse } from "@/types/pagination.types";
import { Team } from "@/types/team.types";
import { customFetch } from "@/lib/custom_fetch";

export default class teamService {
  static async getAll(
    tournament_id: number,
    sort: string = "avg_sr",
    order: string = "asc"
  ): Promise<PaginatedResponse<Team>> {
    return customFetch(`${API_URL}/teams`, {
      query: {
        page: 1,
        per_page: -1,
        sort: sort,
        order: order,
        entities: ["players", "players.user", "placement", "group"],
        tournament_id: tournament_id
      }
    }).then((response) => response.json());
  }
}
