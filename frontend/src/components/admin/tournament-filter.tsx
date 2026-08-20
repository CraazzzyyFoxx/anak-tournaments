"use client";

/**
 * Shared "filter by tournament" scaffolding for the CRUD admin pages
 * (encounters, players, standings, teams): the query-param constant, its
 * parser, the pure query-string builder each page's filter-change handler
 * wraps with its own extra side effects (resetting local form/tab state),
 * and the `<Select>` dropdown rendered in `AdminDataTable`'s `actions` slot.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { Tournament } from "@/types/tournament.types";

export const TOURNAMENT_QUERY_PARAM = "tournament";

export function parseTournamentQueryParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** The next `?tournament=` query string for a `<Select>` change, preserving
 * every other search param already on the URL. */
export function nextTournamentFilterQuery(
  currentSearch: string,
  queryParam: string,
  value: string
): string {
  const nextParams = new URLSearchParams(currentSearch);
  if (value === "all") {
    nextParams.delete(queryParam);
  } else {
    nextParams.set(queryParam, value);
  }
  return nextParams.toString();
}

interface TournamentFilterSelectProps {
  tournaments: Tournament[];
  selectedTournamentId: number | null;
  onValueChange: (value: string) => void;
}

/** The "Filter by tournament" dropdown used as an `AdminDataTable` `actions` slot. */
export function TournamentFilterSelect({
  tournaments,
  selectedTournamentId,
  onValueChange
}: Readonly<TournamentFilterSelectProps>) {
  return (
    <Select value={selectedTournamentId?.toString() ?? "all"} onValueChange={onValueChange}>
      <SelectTrigger className="w-[220px]" aria-label="Filter by tournament">
        <SelectValue placeholder="Filter by tournament" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All tournaments</SelectItem>
        {tournaments.map((tournament) => (
          <SelectItem key={tournament.id} value={tournament.id.toString()}>
            {tournament.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
