import { Suspense, cache } from "react";
import type { CharacterSummary, CharacterWithUserStats, User, UserMapRead, UserProfile } from "@/types/user.types";
import { AchievementRarity } from "@/types/achievement.types";
import userService from "@/services/user.service";
import { Skeleton } from "@/components/ui/skeleton";
import OverviewLastTournamentCard from "@/app/(site)/users/components/overview/OverviewLastTournamentCard";
import OverviewRoleSplit from "@/app/(site)/users/components/overview/OverviewRoleSplit";
import OverviewRecentEncounters from "@/app/(site)/users/components/overview/OverviewRecentEncounters";
import OverviewCareerList from "@/app/(site)/users/components/overview/OverviewCareerList";
import OverviewTeammatesSynergy from "@/app/(site)/users/components/overview/OverviewTeammatesSynergy";
import CharacterStatsTable from "@/components/profile/CharacterStatsTable";
import ProfileWidget from "@/components/profile/ProfileWidget";
import OverviewAchievementsPreview from "@/app/(site)/users/components/overview/OverviewAchievementsPreview";
import { tournamentMapPips } from "@/app/(site)/users/components/overview/map-results";
import { getPlayerSlug } from "@/lib/player";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { StatsScope } from "@/lib/site/stats-scope";

interface OverviewPageProps {
  profile: UserProfile;
  user: User;
  tournamentId?: number;
  scope: StatsScope;
  /** The one game the profile shows; every stats read below names it. */
  discipline: string;
  /** The workspace axis the profile is viewed on: role names and hues read that axis's ontology. */
  axis: WorkspaceAxis;
}

/** What a section reads with. */
interface SectionProps {
  user: User;
  scope: StatsScope;
  discipline: string;
  /** The viewed workspace axis the game's metadata is read on (tenant host: its own). */
  axis: WorkspaceAxis;
}

// Reads shared by more than one section. `cache()` collapses them to a single
// request per render even though each section awaits them from its own
// Suspense boundary.
const getTournaments = cache((userId: number, scope: StatsScope, discipline: string) =>
  userService.getUserTournaments(userId, discipline, scope === "all" ? "all" : undefined).catch(() => [])
);
const getCharacters = cache((userId: number, scope: StatsScope, discipline: string) =>
  userService.getUserCharacters(userId, discipline, { scope }).catch(() => null)
);
const getMaps = cache((userId: number, scope: StatsScope, discipline: string) =>
  userService.getUserMaps(userId, discipline, { perPage: -1, minCount: 1, scope }).catch(() => null)
);

export const UserOverviewPageSkeleton = () => {
  return (
    <div className="aqt-player grid grid-cols-1 gap-3.5 xl:grid-cols-[1fr_380px]">
      <div className="flex min-w-0 flex-col gap-3.5">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-[26rem] w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
      <div className="flex min-w-0 flex-col gap-3.5">
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </div>
  );
};

const LastTournamentSection = async ({
  user,
  profile,
  tournamentId
}: {
  user: User;
  profile: UserProfile;
  tournamentId?: number;
}) => {
  const resolvedTournamentId = tournamentId ?? profile.tournaments[0]?.id;
  if (!resolvedTournamentId) return null;

  const [tournament, tournamentEncounters] = await Promise.all([
    userService.getUserTournament(user.id, resolvedTournamentId),
    userService.getUserTournamentEncounters(user.id, resolvedTournamentId).catch(() => [])
  ]);
  if (!tournament) return null;

  return (
    <OverviewLastTournamentCard
      tournament={tournament}
      tournaments={profile.tournaments}
      userId={user.id}
      mapPips={tournamentMapPips(tournamentEncounters, user.id)}
    />
  );
};

const CareerListSection = async ({ user, profile, scope, discipline }: SectionProps & { profile: UserProfile }) => (
  <OverviewCareerList profile={profile} tournaments={await getTournaments(user.id, scope, discipline)} />
);

/**
 * What the overview's character cards read: each character's stats without its per-stat best-match records (they
 * would ride the RSC payload once per row), and per-character game counts summed over the player's maps (`null`
 * without map data).
 */
const characterCards = (characters: CharacterWithUserStats[], maps: UserMapRead[]) => {
  const games: Record<number, number> = {};
  for (const map of maps) {
    for (const row of map.character_stats ?? []) games[row.character.id] = (games[row.character.id] ?? 0) + row.games;
  }
  return {
    characters: characters.map<CharacterSummary>(({ character, stats }) => ({
      character,
      stats: stats.map(({ name, overall, avg_10, avg_10_all }) => ({ name, overall, avg_10, avg_10_all }))
    })),
    games: maps.length > 0 ? games : null
  };
};

const TopHeroesSection = async ({ user, userSlug, scope, discipline, axis }: SectionProps & { userSlug: string }) => {
  const [charactersRes, mapsRes] = await Promise.all([
    getCharacters(user.id, scope, discipline),
    getMaps(user.id, scope, discipline)
  ]);
  const { characters, games } = characterCards(charactersRes?.results ?? [], mapsRes?.results ?? []);
  if (characters.length === 0) return null;
  return (
    <ProfileWidget
      axis={axis}
      discipline={discipline}
      slot="topCharacters"
      props={{ characters, games, userSlug }}
      fallback={<CharacterStatsTable axis={axis} discipline={discipline} characters={characters} limit={8} />}
    />
  );
};

const RecentEncountersSection = async ({ user, scope, discipline }: SectionProps) => {
  const [encounters, tournaments] = await Promise.all([
    userService
      .getUserEncounters(
        user.id,
        discipline,
        1,
        5,
        "played_at",
        "desc",
        ["tournament", "stage", "stage_item", "teams", "matches.map"],
        undefined,
        scope
      )
      .catch(() => ({ results: [], total: 0 })),
    getTournaments(user.id, scope, discipline)
  ]);
  return (
    <OverviewRecentEncounters
      encounters={encounters.results}
      userId={user.id}
      userName={user.name}
      tournaments={tournaments}
    />
  );
};

const RoleSplitSection = async ({
  user,
  profile,
  scope,
  discipline,
  axis
}: SectionProps & { profile: UserProfile }) => {
  const [charactersRes, mapsRes] = await Promise.all([
    getCharacters(user.id, scope, discipline),
    getMaps(user.id, scope, discipline)
  ]);
  const { characters, games } = characterCards(charactersRes?.results ?? [], mapsRes?.results ?? []);
  return (
    <OverviewRoleSplit profile={profile} discipline={discipline} axis={axis} characters={characters} games={games} />
  );
};

const AchievementsSection = async ({ user, userSlug, scope }: Pick<SectionProps, "user" | "scope"> & { userSlug: string }) => {
  const achievements = await userService
    .getUserAchievements(user.id, { scope })
    .catch(() => [] as AchievementRarity[]);
  return <OverviewAchievementsPreview achievements={achievements} userSlug={userSlug} />;
};

const TeammatesSection = async ({ user, scope, discipline }: SectionProps) => {
  const teammates = await userService
    .getUserBestTeammates(user.id, discipline, -1, scope)
    .catch(() => ({ results: [], total: 0 }));
  if (teammates.results.length === 0) return null;

  return (
    <OverviewTeammatesSynergy
      teammates={teammates.results}
      totalCount={teammates.total ?? teammates.results.length}
      totalMaps={teammates.results.reduce((sum, tm) => sum + (tm.tournaments ?? 0), 0)}
    />
  );
};

/**
 * Overview tab. Every section fetches behind its own Suspense boundary so the
 * tab paints at the pace of the fastest read instead of the slowest — the
 * career-wide teammates and maps reads are unbounded and used to gate the
 * whole grid.
 */
const UserOverviewPage = ({ profile, tournamentId, user, scope, discipline, axis }: OverviewPageProps) => {
  const userSlug = getPlayerSlug(user.name);
  const section = { user, scope, discipline, axis };

  return (
    <div className="aqt-player grid grid-cols-1 gap-3.5 xl:grid-cols-[1fr_380px] xl:items-start">
      <div className="flex min-w-0 flex-col gap-3.5">
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <LastTournamentSection user={user} profile={profile} tournamentId={tournamentId} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-[26rem] w-full rounded-xl" />}>
          <CareerListSection {...section} profile={profile} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
          <TopHeroesSection {...section} userSlug={userSlug} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
          <RecentEncountersSection {...section} />
        </Suspense>
      </div>
      {/* Below the tab strip's z-40 so it scrolls under the bar, not through it. */}
      <aside className="z-30 flex min-w-0 flex-col gap-3.5 xl:sticky xl:top-[var(--aqt-sticky-top)]">
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
          <RoleSplitSection {...section} profile={profile} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <AchievementsSection user={user} userSlug={userSlug} scope={scope} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
          <TeammatesSection {...section} />
        </Suspense>
      </aside>
    </div>
  );
};

export default UserOverviewPage;
