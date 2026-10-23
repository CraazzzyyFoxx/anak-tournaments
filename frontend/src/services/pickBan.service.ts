import { apiFetch } from "@/lib/api/fetch";
import type { MatchImport, MatchImportInput } from "@/types/encounter.types";
import type {
  MapVetoMode,
  PickBanAction,
  PickBanConfig,
  PickBanConfigUpsertInput,
  PickBanGame,
  PickBanKind,
  PickBanRuleset,
  PickBanRulesCatalog,
  PickBanRulesPreview,
  PickBanRulesValidation,
  PickBanState,
  PickBanSubmissionItem,
  PickBanUndo
} from "@/types/tournament.types";

export interface PickBanActionInput {
  /** The catalog item (a hero or map) — or, on a `side_pick` step, the zero-based index into `state.sides` (0 is valid). */
  item_id: number;
  action: PickBanAction;
  /** Required on a step with a `target`: the opponent player the item is banned for. */
  target_player_id?: number | null;
  /** A mix's member pick: the player (`PickBanMember.id`) the hero is for -- yourself, or as captain a teammate. */
  member_id?: number | null;
}

export interface PickBanSubmitInput {
  /** Replaces the participation's whole draft for the current (blind) step. */
  items: PickBanSubmissionItem[];
  /** true = final; the step reveals once every acting participation locked. */
  lock: boolean;
}

interface PickBanRulesPreviewInput {
  kind: PickBanKind;
  mode: MapVetoMode;
  ruleset: PickBanRuleset;
  best_of: number;
  item_ids: number[];
  slots: { candidates: number[]; reserve_item_id?: number | null }[];
}

interface ElectOpenerInput {
  /** The participation (`EncounterTeam.id`) that opens the next round. */
  first_team_id: number;
}

/** One participation's numbers inside a game claim or an admin correction. */
interface GameResultLineInput {
  encounter_team_id: number;
  score?: number | null;
  placement?: number | null;
  column_values?: Record<string, number>;
}

interface GameReportInput {
  /** The `game.result_version` the claim is made against; a correction in between makes it stale (409). */
  basis_version: number;
  results: GameResultLineInput[];
}

interface GameReportResult {
  disputed: boolean;
  resolved: boolean;
  game: PickBanGame;
}

/** `EncounterTeam.id` (as a string) -> whether that captain confirmed readiness. */
type ReadinessMap = Record<string, boolean>;

class PickBanService {
  /**
   * Fetch one kind's pick-ban room state. 200-with-`reason` contract: `null`
   * is reserved for hard failures (404 encounter), never for "not configured
   * yet" / "not ready yet" — those come back as `reason` on a normal 200.
   */
  async getPickBanState(kind: PickBanKind, encounterId: number): Promise<PickBanState | null> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/state`, {
      throwOnError: false
    });
    if (!response.ok) return null;
    return response.json();
  }

  /** One item on an OPEN step (applied and public immediately). Returns the new state. */
  async performPickBanAction(
    kind: PickBanKind,
    encounterId: number,
    data: PickBanActionInput
  ): Promise<PickBanState> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/act`, {
      method: "POST",
      body: data
    });
    return response.json();
  }

  /** Save (or lock) the calling captain's draft on a BLIND step. Returns the new state. */
  async submitDraft(
    kind: PickBanKind,
    encounterId: number,
    data: PickBanSubmitInput
  ): Promise<PickBanState> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/submit`, {
      method: "POST",
      body: data
    });
    return response.json();
  }

  /**
   * Reopen the last revealed blind step for EVERY acting participation (unilateral, limited by
   * the step's `dispute.max`). Each participation's new draft is prefilled with its
   * previous items. Returns the new state.
   */
  async disputeStep(kind: PickBanKind, encounterId: number): Promise<PickBanState> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/dispute`, {
      method: "POST",
      body: {}
    });
    return response.json();
  }

  async electOpener(
    kind: PickBanKind,
    encounterId: number,
    data: ElectOpenerInput
  ): Promise<unknown> {
    const response = await apiFetch(
      `/api/v1/encounters/${encounterId}/pick-ban/${kind}/elect-opener`,
      {
        method: "POST",
        body: data
      }
    );
    return response.json();
  }

  /**
   * Records the calling captain's consent to undo the session's last action.
   * The OPPONENT's matching call is what applies it — this is a mutual
   * agreement, not a take-back. `consent: false` withdraws an open request
   * (the asker changing their mind and the opponent refusing are one outcome).
   */
  async undoLastAction(
    kind: PickBanKind,
    encounterId: number,
    consent = true
  ): Promise<PickBanUndo> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/undo`, {
      method: "POST",
      body: { consent }
    });
    return response.json();
  }

  /**
   * Files the calling captain's claim for ONE game. Agreement confirms the
   * game (`resolved`) and opens the next position; a clash leaves both claims
   * standing (`disputed`). A confirmed game rejects this with 409
   * `result_locked` — only `correctGameResult` may change it.
   */
  async reportGame(
    encounterId: number,
    gameId: number,
    data: GameReportInput
  ): Promise<GameReportResult> {
    const response = await apiFetch(
      `/api/v1/encounters/${encounterId}/games/${gameId}/report`,
      { method: "POST", body: data }
    );
    return response.json();
  }

  /** Names the map a freeplay position was played on, before its result. */
  async selectGameMap(
    encounterId: number,
    gameId: number,
    data: { map_id: number }
  ): Promise<{ game: PickBanGame }> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/games/${gameId}/map`, {
      method: "POST",
      body: data
    });
    return response.json();
  }

  /**
   * Admin correction of a confirmed or disputed game. `reason` is required —
   * it is what the result audit records. 409 `dependent_round_started` when the
   * next game's pick-ban already ran on the old result.
   */
  async correctGameResult(
    encounterId: number,
    gameId: number,
    data: { results: GameResultLineInput[]; reason: string }
  ): Promise<{ game: PickBanGame; rebuilt_rounds: number[] }> {
    const response = await apiFetch(
      `/api/v1/admin/encounters/${encounterId}/games/${gameId}/result`,
      { method: "POST", body: data }
    );
    return response.json();
  }

  /** One game's match imports, newest first; `admin` reads the organizer route, which adds the warnings. */
  async listMatchImports(encounterId: number, gameId: number, admin: boolean): Promise<MatchImport[]> {
    const response = await apiFetch(
      `/api/v1/${admin ? "admin/" : ""}encounters/${encounterId}/games/${gameId}/match-import`
    );
    return response.json();
  }

  /**
   * Files a game's match by its id (a captain of the encounter, or `admin` with `match.result`). Re-filing the same
   * id returns its row (a failed one starts over); 409 `match_already_imported` when another game holds it.
   */
  async importMatch(encounterId: number, gameId: number, externalId: string, admin: boolean): Promise<MatchImport> {
    const response = await apiFetch(
      `/api/v1/${admin ? "admin/" : ""}encounters/${encounterId}/games/${gameId}/match-import`,
      { method: "POST", body: { external_id: externalId } satisfies MatchImportInput }
    );
    return response.json();
  }

  /** Confirms the calling captain's team is ready to begin the encounter's
   * pre-game phase (shared gate across both pick-ban kinds). */
  async markReady(encounterId: number): Promise<{ readiness: ReadinessMap }> {
    const response = await apiFetch(`/api/v1/encounters/${encounterId}/ready`, { method: "POST" });
    return response.json();
  }

  async listPublicConfigs(tournamentId: number): Promise<{ configs: PickBanConfig[] }> {
    const response = await apiFetch(`/api/v1/tournaments/${tournamentId}/pick-ban-configs`, {
      skipWorkspace: true,
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
      body: data
    });
    return response.json();
  }

  async deleteConfig(configId: number): Promise<{ deleted: boolean }> {
    const response = await apiFetch(`/api/v1/admin/pick-ban-configs/${configId}`, {
      method: "DELETE"
    });
    return response.json();
  }

  /** Leaf/constraint specs plus the groups and presets of `discipline`, which the constructor builds forms from. */
  async getRulesCatalog(discipline: string, signal?: AbortSignal): Promise<PickBanRulesCatalog> {
    const response = await apiFetch(`/api/v1/pick-ban-rules/catalog`, {
      query: { discipline },
      skipWorkspace: true,
      signal
    });
    return response.json();
  }

  async validateRuleset(
    tournamentId: number,
    data: { kind: PickBanKind; mode: MapVetoMode; ruleset: PickBanRuleset }
  ): Promise<PickBanRulesValidation> {
    const response = await apiFetch(
      `/api/v1/admin/tournaments/${tournamentId}/pick-ban-rules/validate`,
      { method: "POST", body: data }
    );
    return response.json();
  }

  async previewRuleset(tournamentId: number, data: PickBanRulesPreviewInput): Promise<PickBanRulesPreview> {
    const response = await apiFetch(
      `/api/v1/admin/tournaments/${tournamentId}/pick-ban-rules/preview`,
      { method: "POST", body: data }
    );
    return response.json();
  }
}

const pickBanService = new PickBanService();
export default pickBanService;
