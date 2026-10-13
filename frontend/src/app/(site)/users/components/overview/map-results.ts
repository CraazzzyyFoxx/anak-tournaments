import { encounterPerspective, mapKind } from "@/app/(site)/users/components/shared/encounter-perspective";
import type { EncounterWithUserStats } from "@/types/user.types";

export type MapResultPip = "win" | "loss" | "draw";

export function tournamentMapPips(
  encounters: EncounterWithUserStats[],
  selfUserId: number
): MapResultPip[] | null {
  const pips: MapResultPip[] = [];
  for (const encounter of encounters) {
    const { own } = encounterPerspective(encounter, selfUserId);
    for (const match of encounter.matches ?? []) pips.push(mapKind(match, own));
  }
  return pips.length > 0 ? pips : null;
}
