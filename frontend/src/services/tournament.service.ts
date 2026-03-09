import { PaginatedResponse } from "@/types/pagination.types";
import { OwalStack, OwalStandings, Standings, Tournament } from "@/types/tournament.types";
import { customFetch } from "@/lib/custom_fetch";
import { PlayerAnalytics, TournamentAnalytics } from "@/types/analytics.types";

export default class tournamentService {
  static async getAll(isLeague: boolean | null = null): Promise<PaginatedResponse<Tournament>> {
    return customFetch(`tournaments`, {
      query: {
        is_league: isLeague,
        page: 1,
        per_page: -1,
        sort: "id",
        order: "desc",
        entities: ["groups", "participants_count"]
      }
    }).then((response) => response.json());
  }
  static async getOwalSeasons(): Promise<string[]> {
    return customFetch(`tournaments/league/seasons`).then((response) => response.json());
  }

  static async getOwalStandings(season?: string): Promise<OwalStandings> {
    return customFetch(`tournaments/league/results`, {
      query: {
        season
      }
    }).then((response) => response.json());
  }

  static async getOwalStacks(season?: string): Promise<OwalStack[]> {
    return customFetch(`tournaments/league/stacks`, {
      query: {
        season
      }
    }).then((response) => response.json());
  }
  static async get(id: number): Promise<Tournament> {
    return customFetch(`tournaments/${id}`, {
      query: {
        entities: ["participants_count", "groups"]
      }
    }).then((response) => response.json());
  }
  static async getStandings(id: number): Promise<Standings[]> {
    return customFetch(`tournaments/${id}/standings`, {
      query: {
        entities: ["group", "team", "matches_history", "team.group"]
      }
    }).then((response) => response.json());
  }
}
