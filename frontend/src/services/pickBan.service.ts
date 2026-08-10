import { apiFetch } from "@/lib/api-fetch";
import type { PickBanConfig, PickBanConfigUpsertInput, PickBanEntry, PickBanState } from "@/types/tournament.types";

export interface PickBanActionInput {
  item_id: number;
  action: "ban" | "pick" | "protect";
}

export interface ElectOpenerInput {
  first_side: "home" | "away";
}

export interface MapReportInput {
  home_score: number;
  away_score: number;
}

export interface MapReportResult {
  disputed: boolean;
  resolved: boolean;
  match_id: number | null;
}

class PickBanService {
  /**
   * Fetch the hero-pool state. Same 200-with-`reason` contract as
   * `captainService.getMapPoolState`: `null` is reserved for hard failures
   * (404 encounter), never for "not configured yet".
   */
  async getHeroPoolState(encounterId: number): Promise<PickBanState | null> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/hero-pool/state`, { throwOnError: false });
    if (!response.ok) return null;
    return response.json();
  }

  async performHeroVeto(encounterId: number, data: PickBanActionInput): Promise<PickBanEntry> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/hero-pool/veto`, {
      method: "POST",
      body: data,
    });
    return response.json();
  }

  async electOpener(encounterId: number, data: ElectOpenerInput): Promise<unknown> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/hero-pool/elect-opener`, {
      method: "POST",
      body: data,
    });
    return response.json();
  }

  async reportMap(encounterId: number, mapId: number, data: MapReportInput): Promise<MapReportResult> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/map-pool/${mapId}/report`, {
      method: "POST",
      body: data,
    });
    return response.json();
  }

  async listConfigs(tournamentId: number): Promise<{ configs: PickBanConfig[] }> {
    const response = await apiFetch(`/api/v1/admin/tournaments/${tournamentId}/pick-ban-configs`);
    return response.json();
  }

  async upsertConfig(tournamentId: number, data: PickBanConfigUpsertInput): Promise<PickBanConfig> {
    const response = await apiFetch(`/api/v1/admin/tournaments/${tournamentId}/pick-ban-configs`, {
      method: "PUT",
      body: data,
    });
    return response.json();
  }

  async deleteConfig(configId: number): Promise<{ deleted: boolean }> {
    const response = await apiFetch(`/api/v1/admin/pick-ban-configs/${configId}`, { method: "DELETE" });
    return response.json();
  }
}

const pickBanService = new PickBanService();
export default pickBanService;
