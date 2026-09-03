"use client";

import type { Tournament } from "@/types/tournament.types";

import TournamentCard from "./TournamentCard";

/**
 * The card view of the tournaments list.
 *
 * A real `<ul>`/`<li>`: the cards are a list of the same kind of thing, so a
 * screen reader should announce how many there are and let the user step
 * through them. A grid of `<div>`s says nothing about either.
 */
const TournamentsGrid = ({ tournaments }: { tournaments: Tournament[] }) => (
  <ul
    data-tournament-grid
    className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3"
  >
    {tournaments.map((tournament) => (
      <li key={tournament.id} className="flex">
        <TournamentCard tournament={tournament} />
      </li>
    ))}
  </ul>
);

export default TournamentsGrid;
