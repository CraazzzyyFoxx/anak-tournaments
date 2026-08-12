import type { TournamentStatus } from "@/types/tournament.types";

/**
 * Effective lifecycle phase chain for the hub stepper (design D19).
 *
 * Canonical machine order mirrors backend/shared/core/tournament_state.py
 * (PHASE_ORDER): REGISTRATION -> [CHECK_IN] -> [DRAFT] -> LIVE -> PLAYOFFS
 * -> COMPLETED -> [ARCHIVED].
 */
const CANONICAL_ORDER: readonly TournamentStatus[] = [
  "registration",
  "check_in",
  "draft",
  "live",
  "playoffs",
  "completed",
  "archived",
];

export interface EffectivePhase {
  key: TournamentStatus;
  /** Phase is not guaranteed to happen (unscheduled check_in, archived). */
  optional: boolean;
  /** Phase is at or before the tournament's current status. */
  reached: boolean;
  /** Status sits OUTSIDE the effective chain (force-transition drift). The
   * stepper must render it as an off-track marker, not as a chain position —
   * appending it inline reads as "current phase comes after Archived". */
  drifted?: boolean;
}

export interface EffectivePhasesInput {
  teamFormation: string; // "balancer" | "draft"
  /** Statuses present in tournament_phase_schedule. */
  schedule: readonly TournamentStatus[];
  currentStatus?: TournamentStatus;
}

export function effectivePhases({
  teamFormation,
  schedule,
  currentStatus,
}: EffectivePhasesInput): EffectivePhase[] {
  const chain = CANONICAL_ORDER.filter(
    (key) => key !== "draft" || teamFormation === "draft",
  );

  const currentOrder =
    currentStatus === undefined
      ? -1
      : CANONICAL_ORDER.indexOf(currentStatus);

  const phases: EffectivePhase[] = chain.map((key) => ({
    key,
    optional:
      key === "archived" || (key === "check_in" && !schedule.includes(key)),
    reached: currentOrder >= 0 && CANONICAL_ORDER.indexOf(key) <= currentOrder,
  }));

  // Drift: force-transitions can land the tournament on a status outside the
  // effective chain (e.g. "draft" on a balancer tournament). Append it as the
  // current phase instead of breaking the stepper. The completed<->archived
  // cycle never drifts — both statuses are always in the chain.
  if (currentStatus !== undefined && !chain.includes(currentStatus)) {
    phases.push({ key: currentStatus, optional: false, reached: true, drifted: true });
  }

  return phases;
}
