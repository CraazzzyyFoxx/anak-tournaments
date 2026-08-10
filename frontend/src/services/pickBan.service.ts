import { apiFetch } from "@/lib/api-fetch";
import type { PickBanConfig, PickBanConfigUpsertInput, PickBanEntry, PickBanKind, PickBanState } from "@/types/tournament.types";

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

export interface ReadinessMap {
  home: boolean;
  away: boolean;
}

class PickBanService {
  /**
   * Fetch one kind's pick-ban room state. 200-with-`reason` contract: `null`
   * is reserved for hard failures (404 encounter), never for "not configured
   * yet" / "not ready yet" — those come back as `reason` on a normal 200.
   */
  async getPickBanState(kind: PickBanKind, encounterId: number): Promise<PickBanState | null> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/state`, {
      throwOnError: false,
    });
    if (!response.ok) return null;
    return response.json();
  }

  async performPickBanAction(kind: PickBanKind, encounterId: number, data: PickBanActionInput): Promise<PickBanEntry> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/act`, {
      method: "POST",
      body: data,
    });
    return response.json();
  }

  async electOpener(kind: PickBanKind, encounterId: number, data: ElectOpenerInput): Promise<unknown> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/elect-opener`, {
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

  /** Confirms the calling captain's side is ready to begin the encounter's
   * pre-game phase (shared gate across both pick-ban kinds). */
  async markReady(encounterId: number): Promise<{ readiness: ReadinessMap }> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/ready`, { method: "POST" });
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
