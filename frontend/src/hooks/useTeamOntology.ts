"use client";

import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import type { RoleOntology } from "@/lib/roster/ontology";
import type { Tournament } from "@/types/tournament.types";

/**
 * The scoped role dictionary of the game a team played in: the one its tournament belongs to, `null` while that
 * loads (or when the read carries no tournament). Roster orderings and role glyphs are drawn from it, never from a
 * fixed vocabulary.
 */
export function useTeamOntology(team: { tournament?: Pick<Tournament, "workspace_id" | "discipline"> | null }): RoleOntology | null {
  const owner = team.tournament ?? null;
  return useDisciplineMetadata(owner?.workspace_id ?? "all", owner?.discipline ?? null).data ?? null;
}
