import dynamic from "next/dynamic";

import { User } from "@/types/user.types";
import type { StatsScope } from "@/lib/site/stats-scope";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";

const UserHeroesContainer = dynamic(
  () => import("@/app/(site)/users/components/heroes/UserHeroesContainer")
);

const UserHeroesPage = ({
  user,
  tournaments,
  scope,
  discipline,
  axis
}: {
  user: User;
  /** The game's profile tournaments: the tournament filter's options. */
  tournaments: { id: number; name: string }[];
  scope: StatsScope;
  discipline: string;
  axis: WorkspaceAxis;
}) => {
  // Keyed by game: the tournament filter is one game's, never carried into another's.
  return (
    <UserHeroesContainer
      key={discipline}
      userId={user.id}
      tournaments={tournaments}
      scope={scope}
      discipline={discipline}
      axis={axis}
    />
  );
};

export default UserHeroesPage;
