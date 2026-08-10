"use client";

import { useParams } from "next/navigation";

import { HeroBanRoom } from "./_components/HeroBanRoom";

export default function HeroBanRoomPage() {
  const params = useParams<{ id: string; encounterId: string }>();
  const encounterId = Number(params.encounterId);

  return <HeroBanRoom encounterId={encounterId} />;
}
