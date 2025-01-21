import { AxiosResponse } from "axios";
import { axiosWithAuth, API_URL } from "@/lib/interceptors";
import {
  EncounterWithUserStats,
  User,
  UserBestTeammate,
  UserMapRead,
  UserProfile,
  UserTournament,
  UserTournamentWithStats
} from "@/types/user.types";
import { PaginatedResponse, SearchPaginationParams } from "@/types/pagination.types";
import { HeroWithUserStats } from "@/types/hero.types";
import { AchievementRarity } from "@/types/achievement.types";
import { customFetch } from "@/lib/custom_fetch";

export default class userService {
  static async getAll(
    params: SearchPaginationParams
  ): Promise<AxiosResponse<PaginatedResponse<User>>> {
    return axiosWithAuth.get<PaginatedResponse<User>>("/users", {
      params: params,
      paramsSerializer: {
        indexes: null
      }
    });
  }
  static async getUserByName(name: string): Promise<User> {
    return customFetch(`${API_URL}/users/${name}`, {
      query: {
        entities: ["twitch", "discord", "battle_tag"]
      }
    }).then((res) => res.json());
  }

  static async getUserProfile(id: number): Promise<UserProfile> {
    return customFetch(`${API_URL}/users/${id}/profile`).then((res) => res.json());
  }
  static async getUserTournament(
    id: number,
    tournamentId: number
  ): Promise<UserTournamentWithStats | null> {
    return customFetch(`${API_URL}/users/${id}/tournaments/${tournamentId}`).then((res) => {
      if (res.status === 200) {
        return res.json();
      }
      return null;
    });
  }
  static async getUserTournaments(id: number): Promise<UserTournament[]> {
    return customFetch(`${API_URL}/users/${id}/tournaments`).then((res) => res.json());
  }
  static async getUserTopMaps(id: number): Promise<PaginatedResponse<UserMapRead>> {
    return customFetch(`${API_URL}/users/${id}/maps`, {
      query: {
        sort: "winrate",
        order: "desc",
        per_page: -1,
        entities: ["heroes"]
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
    return customFetch(`${API_URL}/users/${id}/encounters`, {
      query: {
        page: page,
        per_page: perPage,
        sort: sort,
        order: order,
        entities: ["tournament", "matches.map", "tournament_group"]
      }
    }).then((res) => res.json());
  }
  static async getUserHeroes(id: number): Promise<PaginatedResponse<HeroWithUserStats>> {
    return customFetch(
      `${API_URL}/users/${id}/heroes`,
      {
        query: {
          per_page: -1,
          sort: "id",
          order: "asc"
        }
      }
    ).then((res) => res.json());
  }
  static async getUserAchievements(id: number): Promise<AchievementRarity[]> {
    return customFetch(`${API_URL}/achievements/user/${id}`, {
      query: {
        entities: ["tournaments"]
      }
    }).then((res) => res.json());
  }
  static async getUserBestTeammates(id: number): Promise<PaginatedResponse<UserBestTeammate>> {
    return customFetch(`${API_URL}/users/${id}/teammates`, {
      query: {
        per_page: 5,
        sort: "winrate",
        order: "desc"
      }
    }).then((res) => res.json());
  }
}
