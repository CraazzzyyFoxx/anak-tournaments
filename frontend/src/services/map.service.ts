import { customFetch } from "@/lib/custom_fetch";
import { PaginatedResponse } from "@/types/pagination.types";
import { MapRead } from "@/types/map.types";

export default class mapService {
  static async getAll({
    page = 1,
    perPage = -1,
    sort = "name",
    order = "asc",
    query
  }: {
    page?: number;
    perPage?: number;
    sort?: "id" | "name" | "gamemode_id";
    order?: "asc" | "desc";
    query?: string;
  } = {}): Promise<PaginatedResponse<MapRead>> {
    return customFetch("maps", {
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
}
