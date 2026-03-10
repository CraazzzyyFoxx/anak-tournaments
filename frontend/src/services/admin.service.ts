import { parserFetch } from "@/lib/parser_fetch";
import { PaginatedResponse } from "@/types/pagination.types";
import { Tournament, TournamentGroup, Standings } from "@/types/tournament.types";
import { Team, Player } from "@/types/team.types";
import { Encounter } from "@/types/encounter.types";
import { User } from "@/types/user.types";
import { Hero } from "@/types/hero.types";
import { Gamemode } from "@/types/gamemode.types";
import { MapRead } from "@/types/map.types";
import {
  TournamentCreateInput,
  TournamentUpdateInput,
  TournamentGroupCreateInput,
  TournamentGroupUpdateInput,
  TeamCreateInput,
  TeamUpdateInput,
  PlayerCreateInput,
  PlayerUpdateInput,
  EncounterCreateInput,
  EncounterUpdateInput,
  StandingUpdateInput,
  UserCreateInput,
  UserUpdateInput,
  DiscordIdentityCreateInput,
  DiscordIdentityUpdateInput,
  BattleTagIdentityCreateInput,
  BattleTagIdentityUpdateInput,
  TwitchIdentityCreateInput,
  TwitchIdentityUpdateInput,
  HeroCreateInput,
  HeroUpdateInput,
  GamemodeCreateInput,
  GamemodeUpdateInput,
  MapCreateInput,
  MapUpdateInput,
  AchievementCreateInput,
  AchievementUpdateInput,
  BulkOperationResult
} from "@/types/admin.types";

class AdminService {
  // ─── Tournament CRUD ───────────────────────────────────────────────────────

  async createTournament(data: TournamentCreateInput): Promise<Tournament> {
    const response = await parserFetch("admin/tournaments", {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateTournament(id: number, data: TournamentUpdateInput): Promise<Tournament> {
    const response = await parserFetch(`admin/tournaments/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteTournament(id: number): Promise<void> {
    await parserFetch(`admin/tournaments/${id}`, {
      method: "DELETE"
    });
  }

  async addTournamentGroup(
    tournamentId: number,
    data: TournamentGroupCreateInput
  ): Promise<TournamentGroup> {
    const response = await parserFetch(`admin/tournaments/${tournamentId}/groups`, {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateTournamentGroup(
    tournamentId: number,
    groupId: number,
    data: TournamentGroupUpdateInput
  ): Promise<TournamentGroup> {
    const response = await parserFetch(`admin/tournaments/${tournamentId}/groups/${groupId}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteTournamentGroup(tournamentId: number, groupId: number): Promise<void> {
    await parserFetch(`admin/tournaments/${tournamentId}/groups/${groupId}`, {
      method: "DELETE"
    });
  }

  async toggleTournamentFinished(tournamentId: number): Promise<Tournament> {
    const response = await parserFetch(`admin/tournaments/${tournamentId}/finish`, {
      method: "POST"
    });
    return response.json();
  }

  // ─── Team CRUD ─────────────────────────────────────────────────────────────

  async createTeam(data: TeamCreateInput): Promise<Team> {
    const response = await parserFetch("admin/teams", {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateTeam(id: number, data: TeamUpdateInput): Promise<Team> {
    const response = await parserFetch(`admin/teams/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteTeam(id: number): Promise<void> {
    await parserFetch(`admin/teams/${id}`, {
      method: "DELETE"
    });
  }

  async addPlayerToTeam(teamId: number, data: PlayerCreateInput): Promise<Player> {
    const response = await parserFetch(`admin/teams/${teamId}/players`, {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async removePlayerFromTeam(teamId: number, playerId: number): Promise<void> {
    await parserFetch(`admin/teams/${teamId}/players/${playerId}`, {
      method: "DELETE"
    });
  }

  async bulkCreateTeamsFromBalancer(
    tournamentId: number,
    file: File
  ): Promise<BulkOperationResult> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("tournament_id", tournamentId.toString());

    const response = await parserFetch("teams/create/balancer", {
      method: "POST",
      body: formData
    });
    return response.json();
  }

  async syncTeamsFromChallonge(tournamentId: number): Promise<BulkOperationResult> {
    const response = await parserFetch("teams/create/challonge", {
      method: "POST",
      body: { tournament_id: tournamentId }
    });
    return response.json();
  }

  // ─── Player CRUD ───────────────────────────────────────────────────────────

  async createPlayer(data: PlayerCreateInput): Promise<Player> {
    const response = await parserFetch("admin/players", {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updatePlayer(id: number, data: PlayerUpdateInput): Promise<Player> {
    const response = await parserFetch(`admin/players/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deletePlayer(id: number): Promise<void> {
    await parserFetch(`admin/players/${id}`, {
      method: "DELETE"
    });
  }

  // ─── Encounter CRUD ────────────────────────────────────────────────────────

  async createEncounter(data: EncounterCreateInput): Promise<Encounter> {
    const response = await parserFetch("admin/encounters", {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateEncounter(id: number, data: EncounterUpdateInput): Promise<Encounter> {
    const response = await parserFetch(`admin/encounters/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteEncounter(id: number): Promise<void> {
    await parserFetch(`admin/encounters/${id}`, {
      method: "DELETE"
    });
  }

  async syncEncountersFromChallonge(tournamentId: number): Promise<BulkOperationResult> {
    const response = await parserFetch("encounter/bulk", {
      method: "POST",
      body: { tournament_id: tournamentId }
    });
    return response.json();
  }

  // ─── Standing Management ───────────────────────────────────────────────────

  async updateStanding(id: number, data: StandingUpdateInput): Promise<Standings> {
    const response = await parserFetch(`admin/standings/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteStanding(id: number): Promise<void> {
    await parserFetch(`admin/standings/${id}`, {
      method: "DELETE"
    });
  }

  async calculateStandings(tournamentId: number): Promise<BulkOperationResult> {
    const response = await parserFetch("standing/create", {
      method: "POST",
      body: { tournament_id: tournamentId }
    });
    return response.json();
  }

  async recalculateStandings(tournamentId: number): Promise<BulkOperationResult> {
    const response = await parserFetch(`admin/standings/recalculate/${tournamentId}`, {
      method: "POST"
    });
    return response.json();
  }

  // ─── User CRUD ─────────────────────────────────────────────────────────────

  async getUsers(params: {
    page?: number;
    per_page?: number;
    search?: string;
  } = {}): Promise<PaginatedResponse<User>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.append("page", params.page.toString());
    if (params.per_page) searchParams.append("per_page", params.per_page.toString());
    if (params.search) searchParams.append("search", params.search);

    const response = await parserFetch(`admin/users?${searchParams.toString()}`);
    return response.json();
  }

  async createUser(data: UserCreateInput): Promise<User> {
    const response = await parserFetch("admin/users", {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateUser(id: number, data: UserUpdateInput): Promise<User> {
    const response = await parserFetch(`admin/users/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteUser(id: number): Promise<void> {
    await parserFetch(`admin/users/${id}`, {
      method: "DELETE"
    });
  }

  async bulkCreateUsersFromCsv(file: File): Promise<BulkOperationResult> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await parserFetch("user/create/csv", {
      method: "POST",
      body: formData
    });
    return response.json();
  }

  // User Identity Management
  async addDiscordIdentity(userId: number, data: DiscordIdentityCreateInput): Promise<User> {
    const response = await parserFetch(`admin/users/${userId}/discord`, {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateDiscordIdentity(
    userId: number,
    identityId: number,
    data: DiscordIdentityUpdateInput
  ): Promise<User> {
    const response = await parserFetch(`admin/users/${userId}/discord/${identityId}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteDiscordIdentity(userId: number, identityId: number): Promise<void> {
    await parserFetch(`admin/users/${userId}/discord/${identityId}`, {
      method: "DELETE"
    });
  }

  async addBattleTagIdentity(userId: number, data: BattleTagIdentityCreateInput): Promise<User> {
    const response = await parserFetch(`admin/users/${userId}/battle-tag`, {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateBattleTagIdentity(
    userId: number,
    identityId: number,
    data: BattleTagIdentityUpdateInput
  ): Promise<User> {
    const response = await parserFetch(`admin/users/${userId}/battle-tag/${identityId}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteBattleTagIdentity(userId: number, identityId: number): Promise<void> {
    await parserFetch(`admin/users/${userId}/battle-tag/${identityId}`, {
      method: "DELETE"
    });
  }

  async addTwitchIdentity(userId: number, data: TwitchIdentityCreateInput): Promise<User> {
    const response = await parserFetch(`admin/users/${userId}/twitch`, {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateTwitchIdentity(
    userId: number,
    identityId: number,
    data: TwitchIdentityUpdateInput
  ): Promise<User> {
    const response = await parserFetch(`admin/users/${userId}/twitch/${identityId}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteTwitchIdentity(userId: number, identityId: number): Promise<void> {
    await parserFetch(`admin/users/${userId}/twitch/${identityId}`, {
      method: "DELETE"
    });
  }

  // ─── Hero CRUD ─────────────────────────────────────────────────────────────

  async getHeroes(params: {
    page?: number;
    per_page?: number;
    search?: string;
    role?: string;
  } = {}): Promise<PaginatedResponse<Hero>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.append("page", params.page.toString());
    if (params.per_page) searchParams.append("per_page", params.per_page.toString());
    if (params.search) searchParams.append("search", params.search);
    if (params.role) searchParams.append("role", params.role);

    const response = await parserFetch(`admin/heroes?${searchParams.toString()}`);
    return response.json();
  }

  async createHero(data: HeroCreateInput): Promise<Hero> {
    const response = await parserFetch("admin/heroes", {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateHero(id: number, data: HeroUpdateInput): Promise<Hero> {
    const response = await parserFetch(`admin/heroes/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteHero(id: number): Promise<void> {
    await parserFetch(`admin/heroes/${id}`, {
      method: "DELETE"
    });
  }

  async syncHeroes(): Promise<BulkOperationResult> {
    const response = await parserFetch("heroes/update", {
      method: "POST"
    });
    return response.json();
  }

  // ─── Gamemode CRUD ─────────────────────────────────────────────────────────

  async getGamemodes(params: {
    page?: number;
    per_page?: number;
    search?: string;
  } = {}): Promise<PaginatedResponse<Gamemode>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.append("page", params.page.toString());
    if (params.per_page) searchParams.append("per_page", params.per_page.toString());
    if (params.search) searchParams.append("search", params.search);

    const response = await parserFetch(`admin/gamemodes?${searchParams.toString()}`);
    return response.json();
  }

  async createGamemode(data: GamemodeCreateInput): Promise<Gamemode> {
    const response = await parserFetch("admin/gamemodes", {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateGamemode(id: number, data: GamemodeUpdateInput): Promise<Gamemode> {
    const response = await parserFetch(`admin/gamemodes/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteGamemode(id: number): Promise<void> {
    await parserFetch(`admin/gamemodes/${id}`, {
      method: "DELETE"
    });
  }

  async syncGamemodes(): Promise<BulkOperationResult> {
    const response = await parserFetch("gamemodes/update", {
      method: "POST"
    });
    return response.json();
  }

  // ─── Map CRUD ──────────────────────────────────────────────────────────────

  async getMaps(params: {
    page?: number;
    per_page?: number;
    search?: string;
    gamemode_id?: number;
  } = {}): Promise<PaginatedResponse<MapRead>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.append("page", params.page.toString());
    if (params.per_page) searchParams.append("per_page", params.per_page.toString());
    if (params.search) searchParams.append("search", params.search);
    if (params.gamemode_id) searchParams.append("gamemode_id", params.gamemode_id.toString());

    const response = await parserFetch(`admin/maps?${searchParams.toString()}`);
    return response.json();
  }

  async createMap(data: MapCreateInput): Promise<MapRead> {
    const response = await parserFetch("admin/maps", {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateMap(id: number, data: MapUpdateInput): Promise<MapRead> {
    const response = await parserFetch(`admin/maps/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteMap(id: number): Promise<void> {
    await parserFetch(`admin/maps/${id}`, {
      method: "DELETE"
    });
  }

  async syncMaps(): Promise<BulkOperationResult> {
    const response = await parserFetch("maps/update", {
      method: "POST"
    });
    return response.json();
  }

  // ─── Achievement CRUD ──────────────────────────────────────────────────────

  async createAchievement(data: AchievementCreateInput): Promise<any> {
    const response = await parserFetch("admin/achievements", {
      method: "POST",
      body: data
    });
    return response.json();
  }

  async updateAchievement(id: number, data: AchievementUpdateInput): Promise<any> {
    const response = await parserFetch(`admin/achievements/${id}`, {
      method: "PATCH",
      body: data
    });
    return response.json();
  }

  async deleteAchievement(id: number): Promise<void> {
    await parserFetch(`admin/achievements/${id}`, {
      method: "DELETE"
    });
  }

  async calculateAchievements(tournamentId?: number): Promise<BulkOperationResult> {
    const response = await parserFetch("achievement/calculate", {
      method: "POST",
      body: tournamentId ? { tournament_id: tournamentId } : {}
    });
    return response.json();
  }

  // ─── Match Logs ────────────────────────────────────────────────────────────

  async processMatchLogs(tournamentId: number, file?: File): Promise<BulkOperationResult> {
    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("tournament_id", tournamentId.toString());

      const response = await parserFetch("logs/upload", {
        method: "POST",
        body: formData
      });
      return response.json();
    } else {
      const response = await parserFetch("logs/process", {
        method: "POST",
        body: { tournament_id: tournamentId }
      });
      return response.json();
    }
  }
}

const adminService = new AdminService();
export default adminService;
