"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

import { tabFallback } from "../../hubQueries";
import { MatchesView } from "../MatchesView";

const ParsedMatchesBrowser = dynamic(
  () =>
    import("@/components/admin/ParsedMatchesBrowser").then((module) => ({
      default: module.ParsedMatchesBrowser
    })),
  { loading: () => tabFallback }
);

export default function ParsedViewPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);

  return (
    <MatchesView tournamentId={tournamentId}>
      {({ workspaceId, tournamentName }) => (
        <ParsedMatchesBrowser
          tournamentId={tournamentId}
          workspaceId={workspaceId}
          tournamentName={tournamentName}
        />
      )}
    </MatchesView>
  );
}
