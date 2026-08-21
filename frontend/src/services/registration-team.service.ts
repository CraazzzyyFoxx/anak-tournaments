import { apiFetch } from "@/lib/api-fetch";
import type {
  RegistrationTeam,
  RegistrationTeamAcceptInput,
  RegistrationTeamCreateInput,
  RegistrationTeamInviteCreated,
  RegistrationTeamInviteInput,
  RegistrationTeamInvitePreview,
  RegistrationTeamListResponse,
} from "@/types/registration-team.types";

/**
 * The eleven team-registration flows plus the two list reads.
 *
 * Note the two different path prefixes, which mirror who owns each operation:
 * team CREATION is scoped under its tournament, while everything afterwards is
 * scoped by team or invite id — a captain editing their roster does not need to
 * restate which tournament it belongs to, and the server resolves it from the row.
 *
 * Accept/decline deliberately take the invite reference in the BODY, never the
 * path: a raw token in a URL lands in access logs, browser history and `Referer`
 * headers.
 */
const registrationTeamService = {
  /** The public roster of registered teams. Invites are omitted server-side. */
  async listPublic(tournamentId: number): Promise<RegistrationTeamListResponse> {
    const response = await apiFetch(`/api/v1/tournaments/${tournamentId}/registration-teams`);
    return response.json();
  },

  /** Organizer view: includes invites, and optionally terminal teams. */
  async listAdmin(
    tournamentId: number,
    options?: { includeTerminal?: boolean },
  ): Promise<RegistrationTeamListResponse> {
    const response = await apiFetch(
      `/api/v1/admin/balancer/tournaments/${tournamentId}/registration-teams`,
      { query: options?.includeTerminal ? { include_terminal: "true" } : undefined },
    );
    return response.json();
  },

  async create(tournamentId: number, input: RegistrationTeamCreateInput): Promise<RegistrationTeam> {
    const response = await apiFetch(`/api/v1/tournaments/${tournamentId}/registration-teams`, {
      method: "POST",
      body: input,
    });
    return response.json();
  },

  /**
   * Set the team's logo. Captain-only, enforced server-side.
   *
   * Deliberately a SECOND call after `create` rather than a field on its payload:
   * `create_team` runs one transaction that must also write the captain's
   * registration, and an S3 round trip inside it would either lengthen that lock
   * or, on failure, roll back a team the captain already named. A failed logo
   * upload must leave the team standing.
   */
  async uploadImage(teamId: number, file: File): Promise<RegistrationTeam> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiFetch(`/api/v1/registration-teams/${teamId}/image`, {
      method: "POST",
      body: formData,
    });
    return response.json();
  },

  async deleteImage(teamId: number): Promise<RegistrationTeam> {
    const response = await apiFetch(`/api/v1/registration-teams/${teamId}/image`, {
      method: "DELETE",
    });
    return response.json();
  },

  /** Returns the invite plus, for a link invite, the raw token — shown ONCE. */
  async invite(
    teamId: number,
    input: RegistrationTeamInviteInput,
  ): Promise<RegistrationTeamInviteCreated> {
    const response = await apiFetch(`/api/v1/registration-teams/${teamId}/invites`, {
      method: "POST",
      body: input,
    });
    return response.json();
  },

  async revokeInvite(inviteId: number): Promise<void> {
    await apiFetch(`/api/v1/registration-teams/invites/${inviteId}`, { method: "DELETE" });
  },

  async accept(input: RegistrationTeamAcceptInput): Promise<RegistrationTeam> {
    const response = await apiFetch(`/api/v1/registration-teams/invites/accept`, {
      method: "POST",
      body: input,
    });
    return response.json();
  },

  async decline(input: { token?: string; invite_id?: number }): Promise<void> {
    await apiFetch(`/api/v1/registration-teams/invites/decline`, { method: "POST", body: input });
  },

  async kick(teamId: number, registrationId: number): Promise<void> {
    await apiFetch(`/api/v1/registration-teams/${teamId}/members/${registrationId}`, {
      method: "DELETE",
    });
  },

  async leave(teamId: number): Promise<void> {
    await apiFetch(`/api/v1/registration-teams/${teamId}/members/me`, { method: "DELETE" });
  },

  async transferCaptaincy(teamId: number, registrationId: number): Promise<void> {
    await apiFetch(`/api/v1/registration-teams/${teamId}/captain/${registrationId}`, {
      method: "POST",
    });
  },

  async disband(teamId: number): Promise<void> {
    await apiFetch(`/api/v1/registration-teams/${teamId}`, { method: "DELETE" });
  },

  /** Organizer refuses a team. `withdrawMembers` defaults to true server-side:
   *  leaving members approved strands them with a live registration for a
   *  tournament they cannot play in. */
  async reject(
    tournamentId: number,
    teamId: number,
    options?: { withdrawMembers?: boolean },
  ): Promise<RegistrationTeam> {
    const response = await apiFetch(
      `/api/v1/admin/balancer/tournaments/${tournamentId}/registration-teams/${teamId}/reject`,
      { method: "POST", body: { withdraw_members: options?.withdrawMembers ?? true } },
    );
    return response.json();
  },

  /** Materialize complete teams into `tournament.team`. Refuses when standings
   *  already exist for teams it does not own, so it cannot invalidate a bracket. */
  async exportRegistered(
    tournamentId: number,
    teamIds?: number[],
  ): Promise<{
    removed_teams: number;
    imported_teams: number;
    created_players: number;
    skipped: { team_id: number; name: string; code: string }[];
  }> {
    const response = await apiFetch(
      `/api/balancer/tournaments/${tournamentId}/registered-teams/export`,
      { method: "POST", body: teamIds?.length ? { team_ids: teamIds } : {} },
    );
    return response.json();
  },

  /**
   * Resolve a shared invite link. The only anonymous call in this service.
   *
   * POST for a read on purpose: the token must not land in a query string, where
   * it would be logged by every hop. It reaches the server in the body, and the
   * link itself keeps it in the URL fragment, which no browser transmits at all.
   */
  async previewInvite(token: string): Promise<RegistrationTeamInvitePreview> {
    const response = await apiFetch("/api/v1/registration-teams/invites/preview", {
      method: "POST",
      body: { token },
      // Neither is known on the landing page, and neither is needed: the token is
      // the whole credential and the invite names its own tournament.
      skipAuth: true,
      skipWorkspace: true,
    });
    return response.json();
  },
};

export default registrationTeamService;
