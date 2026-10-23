"use client";

import { useEffect, useEffectEvent } from "react";
import { useTranslations } from "next-intl";

import { PickBanPanel } from "@/components/pick-ban/PickBanPanel";
import { PregameAdminControls } from "@/components/pick-ban/PregameAdminControls";
import { stepSubmissions, type PickBanSeat } from "@/components/pick-ban/pick-ban-model";
import { useSideLabel } from "@/components/pick-ban/useSideLabel";
import { Skeleton } from "@/components/ui/skeleton";
import { useMixBanRoom } from "@/app/balancer/mix/_hooks/useMixBanRoom";
import { useTurnAlert } from "@/app/balancer/mix/_hooks/useTurnAlert";

/**
 * A lobby's Pre-game (spec §8): the tournament ban board on the mix's live match -- and, with a pick preset, the
 * players' picks and the captains' assignment. Captains act on their turns from the board; hosts act for either team
 * through the organizer controls (no technical loss: a mix records its result with Record). `onComplete` fires once
 * when the room is done -- the bans finished or a host cancelled it -- so the room re-reads the lobby, which then
 * reads Live.
 */
export function MixBanBoard({
  encounterId,
  workspaceId,
  discipline,
  seats,
  canHost,
  onComplete,
}: Readonly<{
  encounterId: number;
  workspaceId: number;
  discipline: string;
  seats: PickBanSeat[];
  canHost: boolean;
  onComplete: () => void;
}>) {
  const t = useTranslations("mixes.room");
  const room = useMixBanRoom(encounterId, discipline);
  const sideLabelOf = useSideLabel();
  const state = room.state;
  // A pick or an assignment says so in the tab title; a ban keeps its own (spec §11.6 R4-11). Each step (and each
  // reopening of one) is a turn of its own, so two picks of the viewer's in a row alert twice.
  const picking = state?.expected_action === "pick" || state?.expected_action === "assign";
  const turnStep = state?.current_step_index ?? null;
  const turnAttempt =
    state != null && turnStep != null ? (stepSubmissions(state.submissions, turnStep)[0]?.attempt ?? 1) : 0;
  useTurnAlert(
    state?.viewer_can_act === true,
    t(picking ? "yourPickTitle" : "yourTurnTitle"),
    `${state?.session?.id}:${turnStep}:${turnAttempt}`
  );
  // An effect event: the room hands a fresh callback every render, and the re-read must still happen once.
  const complete = useEffectEvent(onComplete);
  useEffect(() => {
    if (room.done) complete();
  }, [room.done]);

  if (state?.session == null) return <Skeleton className="h-64 w-full rounded-xl" />;
  const session = state.session;
  const sideLabels = state.sides.map((code) => sideLabelOf(discipline, code));
  return (
    // Bottom padding clears the board's fixed command bar.
    <div className="pb-56 sm:pb-28">
      <PickBanPanel
        kind="hero"
        encounterId={encounterId}
        encounter={{ workspace_id: workspaceId, discipline, teams: seats }}
        previousMatchId={null}
        state={state}
        session={session}
        queryKey={room.queryKey}
        itemsById={room.heroesById}
        isAdmin={canHost}
        adminPanel={
          canHost
            ? (slot) => (
                <PregameAdminControls
                  kind="hero"
                  encounterId={encounterId}
                  state={state}
                  selectedItemId={slot.selectedItemId}
                  selectedItemName={slot.selectedItemName}
                  itemsById={room.heroesById}
                  sideLabels={sideLabels}
                  games={[]}
                  blind={slot.blind}
                  seats={seats}
                  bestOf={1}
                  seriesWins={null}
                  onMutated={slot.onMutated}
                  technicalLoss={false}
                />
              )
            : undefined
        }
        header={
          <h2 className="font-display text-title font-semibold">
            {t(state.sequence.some((step) => step.action === "pick") ? "picksTitle" : "bansTitle")}
          </h2>
        }
      />
    </div>
  );
}
