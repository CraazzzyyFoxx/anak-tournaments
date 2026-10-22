import { apiFetch } from "@/lib/api/fetch";
import type { CaptainReport, CaptainReportsResponse } from "@/types/encounter.types";
interface CaptainMapCodeInput {
  map_index: number;
  code: string;
}

/** One participation's line of a series report: its wins in a duel, its points in a lobby. */
interface CaptainReportResultInput {
  encounter_team_id: number;
  score: number;
  placement?: number | null;
  /** Omitted when the encounter's rule does not count wins (a lobby's card). */
  wins?: number | null;
}

/** `TeamReportIn`: the finished series as one captain saw it. */
interface CaptainReportInput {
  /** The `encounter.result_version` the form was filled against. */
  basis_version: number;
  /** Draws included: how many of the series' positions were actually played. */
  games_played: number;
  /** One line per live participation. */
  results: CaptainReportResultInput[];
  /** 1..10, or null when the tournament disables/does not require match quality. */
  closeness: number | null;
  map_codes: CaptainMapCodeInput[];
  comment?: string | null;
  custom_fields?: Record<string, string>;
}

export interface CaptainReportSubmitResult {
  id: number;
  result_status: string;
  status: string;
  result_source: string | null;
  result_version: number;
  /** The standing, one line per live participation. */
  teams: { encounter_team_id: number; score: number; placement: number | null }[];
  closeness: number | null;
  reports: CaptainReport[];
}

class CaptainService {
  async submitReport(
    encounterId: number,
    data: CaptainReportInput
  ): Promise<CaptainReportSubmitResult> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/report`, {
      method: "POST",
      body: data,
    });
    return response.json();
  }

  /**
   * Returns the reports *and* the tournament's report-form config: the config
   * rides this envelope so the dialog needs no second round trip and can never
   * render rules that disagree with the reports shown beside them.
   */
  async getReports(encounterId: number): Promise<CaptainReportsResponse> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/reports`);
    return response.json();
  }

  /** The caller's seat in the encounter; both null when they captain none of its participations. */
  async getMyRole(
    encounterId: number
  ): Promise<{ encounter_team_id: number | null; slot: number | null }> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/my-role`);
    return response.json();
  }
}

const captainService = new CaptainService();
export default captainService;
