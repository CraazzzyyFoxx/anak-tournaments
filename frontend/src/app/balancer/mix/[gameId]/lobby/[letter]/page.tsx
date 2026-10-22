"use client";

import { useParams } from "next/navigation";

import { PickupMixScreen } from "@/app/balancer/mix/PickupMixScreen";
import { lobbyIndexFromLetter } from "@/app/balancer/mix/pickup-chrome";

/**
 * One lobby's room (spec §7.5): the overview's screen scoped to the lobby the letter names. Public like the board: a
 * spectator opens the link signed out. A letter the mix does not run renders the not-found card.
 */
export default function BalancerPickupLobbyRoomPage() {
  const params = useParams<{ letter: string }>();
  return <PickupMixScreen roomLobby={lobbyIndexFromLetter(params.letter) ?? -1} />;
}
