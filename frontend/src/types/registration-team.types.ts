/**
 * Team registration: the pre-formation domain.
 *
 * NOT to be confused with `Team` in `team.types.ts`, which is the POST-balancer
 * materialized `tournament.team` row. These are registered teams that have not
 * been exported yet; the link between the two is `exported_team_id`.
 *
 * Mirrors `backend/tournament-service/src/schemas/registration_team.py`.
 */

import type { RosterSlotCode } from "@/lib/roster-shape";
import type { RegistrationCreateInput } from "@/types/registration.types";

/** A registered team's lifecycle. `complete` is NOT terminal — a captain may
 *  still swap a player before the organizer exports. */
export type RegistrationTeamStatus = "forming" | "complete" | "rejected" | "disbanded";

export type RegistrationTeamInviteState = "pending" | "accepted" | "declined" | "revoked";

export interface RegistrationTeamMember {
  registration_id: number;
  display_name: string | null;
  battle_tag: string | null;
  slot_code: string | null;
  is_substitute: boolean;
  is_captain: boolean;
  status: string;
}

export interface RegistrationTeamInvite {
  id: number;
  slot_code: string;
  is_substitute: boolean;
  state: RegistrationTeamInviteState;
  target_auth_user_id: number | null;
  /** True when the invite is a shareable link. The token itself is never served
   *  again — it is returned exactly once, by the create call. */
  is_link: boolean;
  expires_at: string | null;
  invited_at: string | null;
}

export interface RegistrationTeam {
  id: number;
  tournament_id: number;
  name: string;
  image_url: string | null;
  status: RegistrationTeamStatus;
  captain_registration_id: number | null;
  exported_team_id: number | null;
  members: RegistrationTeamMember[];
  /** Only populated for the captain's own view and the organizer's — the public
   *  roster omits them server-side so it cannot leak who declined. */
  invites: RegistrationTeamInvite[];
  /** Slots with nobody accepted yet. Empty object means the roster is complete.
   *  Zero-count entries are stripped server-side. */
  open_slots: Partial<Record<RosterSlotCode, number>>;
  /** Server-rendered "what is still missing", e.g. "1x dps, 2x support". */
  shortfall: string;
  is_complete: boolean;
  substitutes_used: number;
  max_substitutes: number;
}

export interface RegistrationTeamListResponse {
  items: RegistrationTeam[];
  total: number;
  /** Live registrations on no team — the free agents. The export cannot place
   *  them: it materializes registered teams only, and on a team-registration
   *  tournament neither the balancer nor the draft runs. */
  unassigned_players: number;
}

/** The raw invite token rides back exactly once, alongside the created invite. */
export interface RegistrationTeamInviteCreated extends RegistrationTeamInvite {
  token: string | null;
}

// ── request payloads ────────────────────────────────────────────────────────

export interface RegistrationTeamCreateInput {
  name: string;
  /** The slot the captain personally occupies — they are a member like any other. */
  slot_code: RosterSlotCode;
  /** Identical shape to a solo registration; the backend runs the same validation. */
  registration: RegistrationCreateInput;
}

export interface RegistrationTeamInviteInput {
  slot_code: RosterSlotCode;
  is_substitute?: boolean;
  /** Omit for a shareable link invite; set to address a known account in-app. */
  target_auth_user_id?: number | null;
  ttl_days?: number | null;
}

export interface RegistrationTeamAcceptInput {
  /** Exactly one of `token` / `invite_id` — the backend rejects both or neither. */
  token?: string;
  invite_id?: number;
  registration: RegistrationCreateInput;
}

/**
 * What a shared invite link reveals before its holder signs in.
 *
 * Deliberately roster-free: whoever holds the token is not a member yet. It
 * carries `state` AND `is_redeemable` because those answer different questions —
 * the state says what happened to the invite, redeemability says whether the
 * accept form is worth showing. An expired-but-pending invite is both.
 */
export interface RegistrationTeamInvitePreview {
  tournament_id: number;
  tournament_name: string;
  workspace_id: number;
  team_id: number;
  team_name: string;
  slot_code: string;
  is_substitute: boolean;
  state: string;
  expires_at: string | null;
  /** Server-computed: the client's clock is not the one the accept guard uses. */
  is_redeemable: boolean;
}
