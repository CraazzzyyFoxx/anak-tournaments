"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { tabFallback } from "../hubQueries";

// StageManager moved here as-is from inside TournamentSetupTab (T5, SK-O9).
const StageManager = dynamic(
  () =>
    import("../components/StageManager").then((module) => ({
      default: module.StageManager
    })),
  { loading: () => tabFallback }
);

export default function StagesTabPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  return <StageManager tournamentId={tournamentId} />;
}
