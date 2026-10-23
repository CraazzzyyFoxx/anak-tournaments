"use client";

import type { Tournament } from "@/types/tournament.types";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import { cn } from "@/lib/utils";

import TournamentCard from "./TournamentCard";

/**
 * The card view of the tournaments list.
 *
 * A real `<ul>`/`<li>`: the cards are a list of the same kind of thing, so a
 * screen reader should announce how many there are and let the user step
 * through them. A grid of `<div>`s says nothing about either.
 *
 * `className` is how the page shows it below `md` even when the stored view is
 * the table.
 */
const TournamentsGrid = ({
  tournaments,
  games,
  className
}: {
  tournaments: Tournament[];
  games?: Map<string, DisciplineDescriptor>;
  className?: string;
}) => (
  <ul
    data-tournament-grid
    className={cn(
      "grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
      className
    )}
  >
    {tournaments.map((tournament) => (
      <li key={tournament.id} className="flex">
        <TournamentCard tournament={tournament} games={games} />
      </li>
    ))}
  </ul>
);

export default TournamentsGrid;
