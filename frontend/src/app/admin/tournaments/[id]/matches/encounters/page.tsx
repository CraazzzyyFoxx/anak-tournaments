"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

import { tabFallback } from "../../hubQueries";
import { MatchesView } from "../MatchesView";

const EncountersBrowser = dynamic(
  () =>
    import("@/components/admin/EncountersBrowser").then((module) => ({
      default: module.EncountersBrowser
    })),
  { loading: () => tabFallback }
);

export default function EncountersViewPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  return (
    <MatchesView tournamentId={tournamentId}>
      {({ workspaceId }) => (
        <EncountersBrowser tournamentId={tournamentId} workspaceId={workspaceId} />
      )}
    </MatchesView>
  );
}
