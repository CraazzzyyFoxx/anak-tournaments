"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import adminService from "@/services/admin.service";
import { GROUP_STAGE_TYPES } from "../../bracket/projection";
import type { Stage } from "@/types/tournament.types";
import { stageRoundOptions, type PickBanScopeEncounter } from "../../components/pickBanConfig.helpers";

export interface StageRounds {
  /** Ascending round numbers; negative ones are lower-bracket rounds. */
  rounds: number[];
  loading: boolean;
}

/**
 * The rounds of one stage: generated, predicted, or — for a group stage — the
 * count it is configured to play.
 *
 * Elimination round numbering is not guessable client-side (see
 * `stageRoundOptions`): double elimination numbers its lower bracket
 * negatively, and a single elimination's round count follows the team count
 * rather than the stage's `max_rounds`. So the server predicts it from the
 * stage's planned team inputs, running the real generator.
 *
 * A round robin or a Swiss is different: it plays rounds 1..`max_rounds` by
 * definition, whoever the teams turn out to be. That fallback is what lets an
 * organizer author a group stage's per-round map pools before the bracket is
 * generated — which is when they actually do it, and the prediction returns
 * nothing until teams are wired in.
 *
 * Shared by the scope tree and the stage editor: both need the same rounds, and
 * one query key means the second one costs nothing.
 */
export function useStageRounds(
  stage: Stage | null | undefined,
  encounters: PickBanScopeEncounter[] | undefined
): StageRounds {
  const stageId = stage?.id ?? null;
  // Stable identity: callers baseline editor state off these rounds, and a
  // fresh array every render would re-baseline the form under the organizer.
  const generated = useMemo(
    () => (stageId == null ? EMPTY_ROUNDS : stageRoundOptions(stageId, encounters)),
    [stageId, encounters]
  );
  const planned = useMemo(() => {
    if (stage == null || !GROUP_STAGE_TYPES.includes(stage.stage_type)) return EMPTY_ROUNDS;
    return Array.from({ length: Math.max(0, stage.max_rounds) }, (_, index) => index + 1);
  }, [stage]);

  const predicted = useQuery({
    queryKey: ["admin", "stage", stageId, "planned-rounds"],
    queryFn: () => adminService.getStagePlannedRounds(stageId as number),
    enabled: stageId != null && generated.length === 0
  });

  if (generated.length > 0) return { rounds: generated, loading: false };
  if (predicted.data != null && predicted.data.length > 0) {
    return { rounds: predicted.data, loading: false };
  }
  if (predicted.isPending && planned.length === 0) {
    return { rounds: EMPTY_ROUNDS, loading: stageId != null };
  }
  return { rounds: planned, loading: false };
}

const EMPTY_ROUNDS: number[] = [];
