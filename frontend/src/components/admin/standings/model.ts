import type { StandingUpdateInput } from "@/types/admin.types";
import type { Standings } from "@/types/tournament.types";

export const EMPTY_FORM: StandingUpdateInput = {
  points: 0,
  win: 0,
  draw: 0,
  lose: 0,
  buchholz: 0,
  tb: 0
};

export function standingFormOf(standing: Standings | null): StandingUpdateInput {
  if (!standing) return { ...EMPTY_FORM };
  return {
    points: standing.points,
    win: standing.win,
    draw: standing.draw,
    lose: standing.lose,
    buchholz: standing.buchholz ?? 0,
    tb: standing.tb ?? 0
  };
}

/** The stage or stage item a standings row was computed for. */
export function standingScopeLabel(standing: Standings, unassignedLabel: string): string {
  return standing.stage_item?.name ?? standing.stage?.name ?? unassignedLabel;
}
