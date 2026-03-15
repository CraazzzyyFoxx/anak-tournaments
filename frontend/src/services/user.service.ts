import {
  EncounterWithUserStats,
  UserCompareBaselineMode,
  UserCompareResponse,
  UserHeroCompareResponse,
  User,
  UserBestTeammate,
  UserMapRead,
  UserMapsSummary,
  UserOverviewRow,
  UserProfile,
  MinimizedUser,
  UserRoleType,
  UserTournament,
  UserTournamentWithStats
} from "@/types/user.types";
import { PaginatedResponse, SearchPaginationParams } from "@/types/pagination.types";
import { HeroWithUserStats } from "@/types/hero.types";
import { AchievementRarity } from "@/types/achievement.types";
import { LogStatsName } from "@/types/stats.types";
import { customFetch } from "@/lib/custom_fetch";

export default class userService {
  static async getAll(params: SearchPaginationParams): Promise<PaginatedResponse<User>> {
    return customFetch("users", {
      query: {
        ...params
      }
    }).then((res) => res.json());
  }
  static async getUserByName(name: string): Promise<User> {
    return customFetch(`users/${name}`, {
      query: {
        entities: ["twitch", "discord", "battle_tag"]
      }
    }).then((res) => res.json());
  }
  static async getUserProfile(id: number): Promise<UserProfile> {
    return customFetch(`users/${id}/profile`).then((res) => res.json());
  }
  static async getUserTournament(
    id: number,
    tournamentId: number | null
  ): Promise<UserTournamentWithStats | null> {
    return customFetch(`users/${id}/tournaments/${tournamentId}`)
      .then((res) => {
        if (res.status === 200) {
          return res.json();
        }
        return null;
      })
      .catch((error) => {
        console.error("Error fetching user tournament data:", error);
        return null;
      });
  }
  static async getUserTournaments(id: number): Promise<UserTournament[]> {
    return customFetch(`users/${id}/tournaments`).then((res) => res.json());
  }
  static async getUserMaps(
    id: number,
    {
      page = 1,
      perPage = 15,
      sort = "winrate",
      order = "desc",
      query = "",
      minCount,
      gamemodeId
    }: {
      page?: number;
      perPage?: number;
      sort?: string;
      order?: string;
      query?: string;
      minCount?: number;
      gamemodeId?: number | null;
    } = {}
  ): Promise<PaginatedResponse<UserMapRead>> {
    const entities = ["gamemode", "hero_stats"];

    return customFetch(`users/${id}/maps`, {
      query: {
        page,
        per_page: perPage,
        sort,
        order,
        query,
        fields: ["name"],
        min_count: minCount,
        gamemode_id: gamemodeId,
        entities
      }
    }).then((res) => res.json());
  }

  static async getUserMapsSummary(
    id: number,
    {
      query = "",
      minCount,
      gamemodeId
    }: { query?: string; minCount?: number; gamemodeId?: number | null } = {}
  ): Promise<UserMapsSummary> {
    return customFetch(`users/${id}/maps/summary`, {
      query: {
        query,
        fields: ["name"],
        min_count: minCount,
        gamemode_id: gamemodeId,
        entities: ["gamemode"]
      }
    }).then((res) => res.json());
  }
  static async getUserEncounters(
    id: number,
    page: number,
    perPage: number = 10,
    sort: string = "id",
    order: string = "desc"
  ): Promise<PaginatedResponse<EncounterWithUserStats>> {
    return customFetch(`users/${id}/encounters`, {
      query: {
        page: page,
        per_page: perPage,
        sort: sort,
        order: order,
        entities: ["tournament", "matches.map", "tournament_group"]
      }
    }).then((res) => res.json());
  }
  static async getUserHeroes(
    id: number,
    stats?: LogStatsName[],
    tournamentId?: number
  ): Promise<PaginatedResponse<HeroWithUserStats>> {
    return customFetch(`users/${id}/heroes`, {
      query: {
        per_page: -1,
        sort: "id",
        order: "asc",
        stats,
        tournament_id: tournamentId
      }
    }).then((res) => res.json());
  }
  static async getUserAchievements(
    id: number,
    {
      tournamentId,
      withoutTournament
    }: {
      tournamentId?: number;
      withoutTournament?: boolean;
    } = {}
  ): Promise<AchievementRarity[]> {
    return customFetch(`achievements/user/${id}`, {
      query: {
        entities: ["tournaments", "matches"],
        tournament_id: tournamentId,
        without_tournament: withoutTournament
      }
    }).then((res) => res.json());
  }
  static async getUserBestTeammates(id: number): Promise<PaginatedResponse<UserBestTeammate>> {
    return customFetch(`users/${id}/teammates`, {
      query: {
        per_page: 5,
        sort: "winrate",
        order: "desc"
      }
    }).then((res) => res.json());
  }
  static async searchUsers(query: string, signal?: AbortSignal): Promise<MinimizedUser[]> {
    return customFetch(`users/search`, {
      query: {
        query: query,
        fields: ["battle_tag"]
      },
      signal
    }).then((res) => res.json());
  }

  static async getUsersOverview({
    page = 1,
    perPage = 20,
    sort = "name",
    order = "asc",
    query,
    role,
    divMin,
    divMax
  }: {
    page?: number;
    perPage?: number;
    sort?: "id" | "name" | "tournaments_count" | "achievements_count" | "avg_placement";
    order?: "asc" | "desc";
    query?: string;
    role?: UserRoleType;
    divMin?: number;
    divMax?: number;
  } = {}): Promise<PaginatedResponse<UserOverviewRow>> {
    return customFetch("users/overview", {
      query: {
        page,
        per_page: perPage,
        sort,
        order,
        query,
        fields: ["name"],
        role,
        div_min: divMin,
        div_max: divMax
      }
    }).then((res) => res.json());
  }

  static async getUserCompare(
    userId: number,
    {
      baseline = "global",
      targetUserId,
      role,
      divMin,
      divMax,
      tournamentId
    }: {
      baseline?: UserCompareBaselineMode;
      targetUserId?: number;
      role?: UserRoleType;
      divMin?: number;
      divMax?: number;
      tournamentId?: number;
    } = {}
  ): Promise<UserCompareResponse> {
    return customFetch(`users/${userId}/compare`, {
      query: {
        baseline,
        target_user_id: targetUserId,
        role,
        div_min: divMin,
        div_max: divMax,
        tournament_id: tournamentId
      }
    }).then((res) => res.json());
  }

  static async getUserHeroCompare(
    userId: number,
    {
      baseline = "global",
      targetUserId,
      leftHeroId,
      rightHeroId,
      mapId,
      role,
      divMin,
      divMax,
      tournamentId,
      stats
    }: {
      baseline?: UserCompareBaselineMode;
      targetUserId?: number;
      leftHeroId?: number;
      rightHeroId?: number;
      mapId?: number;
      role?: UserRoleType;
      divMin?: number;
      divMax?: number;
      tournamentId?: number;
      stats?: LogStatsName[];
    }
  ): Promise<UserHeroCompareResponse> {
    return customFetch(`users/${userId}/compare/heroes`, {
      query: {
        baseline,
        target_user_id: targetUserId,
        left_hero_id: leftHeroId,
        right_hero_id: rightHeroId,
        map_id: mapId,
        role,
        div_min: divMin,
        div_max: divMax,
        tournament_id: tournamentId,
        stats
      }
    }).then((res) => res.json());
  }
}
