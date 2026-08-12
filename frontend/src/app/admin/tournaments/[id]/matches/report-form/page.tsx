"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { tabFallback } from "../../hubQueries";

const MatchReportFormBuilder = dynamic(
  () =>
    import("@/components/admin/matches/MatchReportFormBuilder").then((module) => ({
      default: module.MatchReportFormBuilder
    })),
  { loading: () => tabFallback }
);

export default function ReportFormTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  // The builder keys its query on the id, so a junk segment must not reach it.
  if (!Number.isFinite(tournamentId) || tournamentId <= 0) {
    return null;
  }

  return <MatchReportFormBuilder tournamentId={tournamentId} />;
}
