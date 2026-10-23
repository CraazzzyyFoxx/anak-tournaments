"use client";

import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import type { UserTournamentEntry, UserTournamentList } from "@/types/user.types";
import userService from "@/services/user.service";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { userQueryKeys } from "@/lib/users/query-keys";
import {
  type TournamentGroup,
  groupEntries,
  groupRepId,
  groupTournamentIds,
  groupTournamentsByLeague,
  isLeagueGroup
} from "@/app/(site)/users/components/tournaments/tournaments-history.helpers";
import TournamentsPlacementTimeline from "@/app/(site)/users/components/tournaments/TournamentsPlacementTimeline";
import TournamentList from "@/app/(site)/users/components/tournaments/TournamentList";
import TournamentDossier from "@/app/(site)/users/components/tournaments/TournamentDossier";

interface Props {
  tournaments: UserTournamentList;
  selfUserId: number;
  /** The career Titles figure of the KPI strip. */
  tournamentsWon: number;
  /** "All games": rows mark their game. */
  showGames?: boolean;
}

const TournamentsHistory = ({ tournaments, selfUserId, tournamentsWon, showGames = false }: Props) => {
  const searchParams = useSearchParams();
  const dossierRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  const groups = useMemo(() => groupTournamentsByLeague(tournaments.results), [tournaments.results]);

  // Default selection: the deep-linked event (?selectedTournamentId=) if it maps
  // to a group, otherwise the most-recent event.
  const initialKey = useMemo(() => {
    const raw = searchParams?.get("selectedTournamentId");
    const id = raw ? Number(raw) : NaN;
    if (Number.isFinite(id)) {
      const match = groups.find((group) => groupTournamentIds(group).includes(id));
      if (match) return groupRepId(match);
    }
    // The API returns events newest-first (by start date).
    return groups.length ? groupRepId(groups[0]) : null;
    // Deep-link is read from the initial searchParams snapshot; selection is
    // client state thereafter (URL is kept in sync via replaceState on select).
  }, [groups, searchParams]);

  const [selectedKey, setSelectedKey] = useState<number | null>(initialKey);

  // Reconcile at render time (no effect) if the selection no longer maps to a
  // group — e.g. the tournaments prop changed.
  const validKeys = useMemo(() => groups.map(groupRepId), [groups]);
  const effectiveKey = selectedKey != null && validKeys.includes(selectedKey) ? selectedKey : initialKey;
  const selectedGroup = useMemo(
    () => groups.find((group) => groupRepId(group) === effectiveKey) ?? null,
    [groups, effectiveKey]
  );
  const selectedIds = useMemo(() => (selectedGroup ? groupTournamentIds(selectedGroup) : []), [selectedGroup]);

  // Lazy dossier detail: the list endpoint never carries encounters — read them per tournament in the selected
  // group only, cached per tournament so re-selecting an event reads nothing, and merge them in (with each entry's
  // grid from the list) before handing the group to the dossier. A failed read leaves that tournament's run empty,
  // without a toast.
  const selectedEntries = selectedGroup ? groupEntries(selectedGroup) : [];
  const encounterQueries = useQueries({
    queries: selectedEntries.map((t) => ({
      queryKey: userQueryKeys.tournamentEncounters(selfUserId, t.workspace_id, t.discipline, t.id),
      queryFn: () => userService.getUserTournamentEncounters(selfUserId, t.id),
      staleTime: 5 * 60 * 1000,
      meta: { suppressErrorToast: true }
    }))
  });
  const loadingEncounters = encounterQueries.some((query) => query.isPending);

  let detailedGroup: TournamentGroup<UserTournamentEntry> | null = null;
  if (selectedGroup) {
    const detailed = selectedEntries.map((t, index) => ({
      ...t,
      division_grid_version:
        tournaments.division_grid_versions.find((version) => version.id === t.division_grid_version_id) ?? null,
      encounters: encounterQueries[index]?.data ?? []
    }));
    detailedGroup = isLeagueGroup(selectedGroup) ? detailed : detailed[0];
  }

  const syncUrl = (id: number) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("selectedTournamentId", String(id));
    window.history.replaceState(null, "", url.toString());
  };

  const scrollToDossier = () => {
    const el = dossierRef.current;
    if (!el || typeof window === "undefined") return;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  const selectEvent = (tournamentId: number) => {
    const match = groups.find((group) => groupTournamentIds(group).includes(tournamentId));
    if (!match) return;
    const key = groupRepId(match);
    setSelectedKey(key);
    syncUrl(key);
    scrollToDossier();
  };

  return (
    <>
      <TournamentsPlacementTimeline
        tournaments={tournaments.results}
        tournamentsWon={tournamentsWon}
        selectedIds={selectedIds}
        onSelect={selectEvent}
      />
      <div className="grid grid-cols-1 gap-3.5 min-[1081px]:grid-cols-[minmax(0,1fr)_404px]">
        <div ref={dossierRef} className="order-2 min-w-0 scroll-mt-4 min-[1081px]:order-1">
          <TournamentDossier
            group={detailedGroup}
            selfUserId={selfUserId}
            loadingEncounters={loadingEncounters}
          />
        </div>
        {/* Desktop: the list is taken out of flow so the row height is the dossier's and the list scrolls inside it. */}
        <div className="order-1 min-[1081px]:relative min-[1081px]:order-2 min-[1081px]:min-h-[520px]">
          <TournamentList groups={groups} selectedKey={effectiveKey} onSelect={selectEvent} showGames={showGames} />
        </div>
      </div>
    </>
  );
};

export default TournamentsHistory;
