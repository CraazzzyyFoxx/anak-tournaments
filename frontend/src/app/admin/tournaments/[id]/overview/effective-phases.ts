import { TOURNAMENT_PHASES, phaseRank } from "@/lib/tournament/lifecycle";
import type { TournamentStatus } from "@/types/tournament.types";

/**
 * Effective lifecycle phase chain for the hub stepper (design D19).
 *
 * The chain is the machine's own order (`@/lib/tournament/lifecycle`) minus the
 * phases this tournament will never enter, and minus Archived: archiving is
 * bookkeeping after the end, not a phase with work in it, so the chain stops
 * at Completed and an archived tournament reads as a completed one.
 */

export interface EffectivePhase {
  key: TournamentStatus;
  /** Phase is at or before the tournament's current status. */
  reached: boolean;
  /** Status sits OUTSIDE the effective chain (force-transition drift). The
   * stepper must render it as an off-track marker, not as a chain position —
   * appending it inline reads as "current phase comes after Completed". */
  drifted?: boolean;
}

export interface EffectivePhasesInput {
  teamFormation: string; // "balancer" | "draft"
  currentStatus?: TournamentStatus;
}

export function effectivePhases({
  teamFormation,
  currentStatus,
}: EffectivePhasesInput): EffectivePhase[] {
  const chain: readonly TournamentStatus[] = TOURNAMENT_PHASES.filter(
    (key) => key !== "archived" && (key !== "draft" || teamFormation === "draft"),
  );
  const position = currentStatus === "archived" ? "completed" : currentStatus;
  const currentOrder = position === undefined ? -1 : phaseRank(position);

  const phases: EffectivePhase[] = chain.map((key) => ({
    key,
    reached: currentOrder >= 0 && phaseRank(key) <= currentOrder,
  }));

  // Drift: force-transitions can land the tournament on a status outside the
  // effective chain (e.g. "draft" on a balancer tournament). Append it as the
  // current phase instead of breaking the stepper.
  if (position !== undefined && !chain.includes(position)) {
    phases.push({ key: position, reached: true, drifted: true });
  }

  return phases;
}
