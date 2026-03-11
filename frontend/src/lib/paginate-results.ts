import { PaginatedResponse } from "@/types/pagination.types";

export function paginateResults<T>(items: T[], page: number, perPage: number): PaginatedResponse<T> {
  const startIndex = (page - 1) * perPage;
  return {
    page,
    per_page: perPage,
    total: items.length,
    results: items.slice(startIndex, startIndex + perPage),
  };
}
