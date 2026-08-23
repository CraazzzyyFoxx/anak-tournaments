"use client";

import { useParams } from "next/navigation";

import { PregameRoom } from "./_components/PregameRoom";

export default function PregameRoomPage() {
  const params = useParams<{ id: string; encounterId: string }>();
  const encounterId = Number(params.encounterId);

  return <PregameRoom encounterId={encounterId} />;
}
