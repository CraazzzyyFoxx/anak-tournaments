"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { tabFallback } from "../../hubQueries";

// D25: the Google Sheets feed builder lives in a neutral place and is rendered
// by both this hub sub-route (tournament from the path) and the legacy balancer
// route (tournament from the query) until T14 retires the latter.
const SheetsFeedPage = dynamic(() => import("@/components/balancer/feed/SheetsFeedPage"), {
  loading: () => tabFallback
});

export default function RegistrationFeedSubRoutePage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  return (
    <SheetsFeedPage
      tournamentId={Number.isFinite(tournamentId) && tournamentId > 0 ? tournamentId : null}
      basePath={`/admin/tournaments/${params.id}/registration`}
    />
  );
}
