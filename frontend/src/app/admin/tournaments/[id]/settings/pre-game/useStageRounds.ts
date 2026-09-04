"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import adminService from "@/services/admin.service";
import { stageRoundOptions, type PickBanScopeEncounter } from "../../components/pickBanConfig.helpers";

export interface StageRounds {
  /** Ascending round numbers; negative ones are lower-bracket rounds. */
  rounds: number[];
  loading: boolean;
}

/**
 * The rounds of one stage, generated or predicted.
 *
 * Elimination round numbering is not guessable client-side before the bracket
 * exists (see `stageRoundOptions`): double elimination numbers its lower
 * bracket negatively, and a single elimination's round count follows the team
 * count rather than the stage's `max_rounds`. So the server predicts it from
 * the stage's planned team inputs, running the real generator, and the
 * prediction is skipped once real encounters exist.
 *
 * Shared by the scope tree and the stage editor: both need the same rounds, and
 * one query key means the second one costs nothing.
 */
export function useStageRounds(
  stageId: number | null,
  encounters: PickBanScopeEncounter[] | undefined
): StageRounds {
  // Stable identity: callers baseline editor state off these rounds, and a
  // fresh array every render would re-baseline the form under the organizer.
  const generated = useMemo(
    () => (stageId == null ? EMPTY_ROUNDS : stageRoundOptions(stageId, encounters)),
    [stageId, encounters]
  );
  const predicted = useQuery({
    queryKey: ["admin", "stage", stageId, "planned-rounds"],
    queryFn: () => adminService.getStagePlannedRounds(stageId as number),
    enabled: stageId != null && generated.length === 0
  });

  if (generated.length > 0) return { rounds: generated, loading: false };
  return {
    rounds: predicted.data ?? EMPTY_ROUNDS,
    loading: stageId != null && predicted.isPending
  };
}

const EMPTY_ROUNDS: number[] = [];
