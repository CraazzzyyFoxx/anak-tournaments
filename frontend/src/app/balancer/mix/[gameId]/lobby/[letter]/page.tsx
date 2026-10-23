"use client";

import { MixRoomScreen } from "@/app/balancer/mix/_room/MixRoomScreen";

/** One lobby's match room (spec §7.5): its teams on the sides, its draft, bans, picks and live match between them. */
export default function BalancerPickupLobbyRoomPage() {
  return <MixRoomScreen />;
}
