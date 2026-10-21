import { randomUUID } from "node:crypto";
import type { Api } from "./api";

export type Discipline = "overwatch" | "lol" | "deadlock";

export function uniq(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export function isoDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export type Workspace = { id: number; slug: string; name: string };

/** A fresh workspace owned by `api`'s user. Scoping every spec to its own keeps runs order-independent. */
export async function createWorkspace(api: Api, name = uniq("ws")): Promise<Workspace> {
  return api.post<Workspace>("/api/v1/workspaces", { slug: name.toLowerCase(), name }, 201);
}

export type Tournament = { id: number; slug: string; name: string; status: string; workspace_id: number; discipline: string };

export async function createTournament(
  api: Api,
  workspaceId: number,
  overrides: Partial<{ discipline: Discipline; name: string; status: string; team_formation: string; is_hidden: boolean; is_league: boolean }> = {}
): Promise<Tournament> {
  return api.post<Tournament>(
    "/api/v1/admin/tournaments",
    {
      workspace_id: workspaceId,
      discipline: "overwatch",
      name: uniq("Cup"),
      start_date: isoDate(7),
      end_date: isoDate(14),
      // Tests drive status explicitly; the 30 s tick must not move it under them.
      auto_transitions_enabled: false,
      ...overrides,
    },
    201
  );
}

/** Manual status change (forced through the matrix when `force`). */
export async function setStatus(api: Api, tournamentId: number, status: string, force = false) {
  return api.patch(`/api/v1/admin/tournaments/${tournamentId}/status`, { status, force });
}
