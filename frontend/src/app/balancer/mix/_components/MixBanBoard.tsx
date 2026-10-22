"use client";

import { useEffect, useEffectEvent } from "react";
import { useTranslations } from "next-intl";

import { PickBanPanel } from "@/components/pick-ban/PickBanPanel";
import { PregameAdminControls } from "@/components/pick-ban/PregameAdminControls";
import type { PickBanSeat } from "@/components/pick-ban/pick-ban-model";
import { useSideLabel } from "@/components/pick-ban/useSideLabel";
import { Skeleton } from "@/components/ui/skeleton";
import { useMixBanRoom } from "@/app/balancer/mix/_hooks/useMixBanRoom";
import { useTurnAlert } from "@/app/balancer/mix/_hooks/useTurnAlert";

/**
 * A lobby's Pre-game (spec §8): the tournament ban board on the mix's live match. Captains act on their turns from
 * the board; hosts act for either team through the organizer controls (no technical loss: a mix records its result
 * with Record). `onComplete` fires once when the room is done -- the bans finished or a host cancelled it -- so the
 * room re-reads the lobby, which then reads Live.
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
  useTurnAlert(state?.viewer_can_act === true, t("yourTurnTitle"));
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
        header={<h2 className="font-display text-title font-semibold">{t("bansTitle")}</h2>}
      />
    </div>
  );
}
