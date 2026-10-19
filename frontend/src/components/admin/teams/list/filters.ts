import { TOURNAMENT_QUERY_PARAM } from "@/components/admin/tournament-filter";
import type { FilterDef } from "@/components/kit/useFilters";

/** The one chip that narrows the roster list: the tournament a team plays in. */
export function teamFilterDefs(
  tournaments: Array<{ id: number; name: string }>,
  tournamentLabel: string
): FilterDef[] {
  return [
    {
      // The URL keeps the `tournament` spelling the sibling admin browsers
      // already use, so a link that pins a tournament still opens pinned.
      key: TOURNAMENT_QUERY_PARAM,
      label: tournamentLabel,
      kind: "single",
      options: tournaments.map((tournament) => ({
        value: String(tournament.id),
        label: tournament.name
      }))
    }
  ];
}
