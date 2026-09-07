import { TournamentHeroesSkeleton } from "../_components/TournamentSkeletons";

export default function Loading() {
  // The default sub-tab is `heroes`; the maps table swaps in its own skeleton
  // once the client view knows which tab the URL asked for.
  return <TournamentHeroesSkeleton />;
}
