import { parserFetch } from "@/lib/parser_fetch";
import {
  BalanceExportResponse,
  BalanceSaveInput,
  BalancerApplication,
  BalancerPlayerCreateInput,
  BalancerPlayerExportResponse,
  BalancerPlayerImportPreviewResponse,
  BalancerPlayerImportResult,
  BalancerPlayerRecord,
  BalancerPlayerRoleSyncResponse,
  BalancerPlayerUpdateInput,
  BalancerTournamentSheet,
  DuplicateResolution,
  DuplicateStrategy,
  SavedBalance,
  SheetSyncResponse,
  TournamentSheetUpsertInput,
} from "@/types/balancer-admin.types";

export default class balancerAdminService {
  static async getTournamentSheet(tournamentId: number): Promise<BalancerTournamentSheet | null> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/sheet`);
    return response.json();
  }

  static async upsertTournamentSheet(
    tournamentId: number,
    data: TournamentSheetUpsertInput,
  ): Promise<BalancerTournamentSheet> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/sheet`, {
      method: "PUT",
      body: data,
    });
    return response.json();
  }

  static async syncTournamentSheet(tournamentId: number): Promise<SheetSyncResponse> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/sheet/sync`, {
      method: "POST",
      body: {},
    });
    return response.json();
  }

  static async listApplications(
    tournamentId: number,
    includeInactive = false,
  ): Promise<BalancerApplication[]> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/applications`, {
      query: { include_inactive: includeInactive },
    });
    return response.json();
  }

  static async createPlayersFromApplications(
    tournamentId: number,
    data: BalancerPlayerCreateInput,
  ): Promise<BalancerPlayerRecord[]> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/players`, {
      method: "POST",
      body: data,
    });
    return response.json();
  }

  static async listPlayers(tournamentId: number, inPoolOnly = false): Promise<BalancerPlayerRecord[]> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/players`, {
      query: { in_pool_only: inPoolOnly },
    });
    return response.json();
  }

  static async updatePlayer(
    playerId: number,
    data: BalancerPlayerUpdateInput,
  ): Promise<BalancerPlayerRecord> {
    const response = await parserFetch(`admin/balancer/players/${playerId}`, {
      method: "PATCH",
      body: data,
    });
    return response.json();
  }

  static async deletePlayer(playerId: number): Promise<void> {
    await parserFetch(`admin/balancer/players/${playerId}`, {
      method: "DELETE",
    });
  }

  static async previewPlayerImport(
    tournamentId: number,
    file: File,
    matchApplicationRoles = false,
  ): Promise<BalancerPlayerImportPreviewResponse> {
    const formData = new FormData();
    formData.append("data", file);
    formData.append("match_application_roles", String(matchApplicationRoles));

    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/players/import/preview`, {
      method: "POST",
      body: formData,
    });
    return response.json();
  }

  static async importPlayers(
    tournamentId: number,
    file: File,
    duplicateStrategy: DuplicateStrategy,
    matchApplicationRoles = false,
    resolutions?: Record<string, DuplicateResolution>,
  ): Promise<BalancerPlayerImportResult> {
    const formData = new FormData();
    formData.append("data", file);
    formData.append("duplicate_strategy", duplicateStrategy);
    formData.append("match_application_roles", String(matchApplicationRoles));
    if (resolutions && Object.keys(resolutions).length > 0) {
      formData.append("resolutions_json", JSON.stringify(resolutions));
    }

    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/players/import`, {
      method: "POST",
      body: formData,
    });
    return response.json();
  }

  static async exportPlayers(tournamentId: number): Promise<BalancerPlayerExportResponse> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/players/export`);
    return response.json();
  }

  static async syncPlayerRolesFromApplications(tournamentId: number): Promise<BalancerPlayerRoleSyncResponse> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/players/application-roles`, {
      method: "POST",
      body: {},
    });
    return response.json();
  }

  static async getBalance(tournamentId: number): Promise<SavedBalance | null> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/balance`);
    return response.json();
  }

  static async saveBalance(tournamentId: number, data: BalanceSaveInput): Promise<SavedBalance> {
    const response = await parserFetch(`admin/balancer/tournaments/${tournamentId}/balance`, {
      method: "PUT",
      body: data,
    });
    return response.json();
  }

  static async exportBalance(balanceId: number): Promise<BalanceExportResponse> {
    const response = await parserFetch(`admin/balancer/balances/${balanceId}/export`, {
      method: "POST",
      body: {},
    });
    return response.json();
  }
}
