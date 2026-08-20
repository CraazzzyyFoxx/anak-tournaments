import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates every cached view that shows an encounter's score/status —
 * shared by the admin edit dialog and the captain match report form, which
 * both write to the same encounter and need the same views to refetch.
 */
export async function refreshEncounterViews(qc: QueryClient, tournamentId: number): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["encounters"] }),
    qc.invalidateQueries({ queryKey: ["standings", tournamentId] }),
    qc.invalidateQueries({ queryKey: ["tournament"] }),
    qc.invalidateQueries({ queryKey: ["encounter"] }),
    qc.invalidateQueries({ queryKey: ["bracket"] })
  ]);
}
