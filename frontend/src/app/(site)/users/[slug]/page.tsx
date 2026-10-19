import React, { Suspense, cache } from "react";
import userService from "@/services/user.service";
import UserHeader from "@/app/(site)/users/components/header/UserHeader";
import { TabsContent } from "@/components/ui/tabs";
import UserOverviewPage, { UserOverviewPageSkeleton } from "@/app/(site)/users/_views/UserOverviewPage";
import UserMapsPage from "@/app/(site)/users/_views/UserMapsPage";
import { notFound } from "next/navigation";
import UserHeroesPage from "@/app/(site)/users/_views/UserHeroesPage";
import {
  UserEncountersPageSkeleton,
  UserEncountersPage
} from "@/app/(site)/users/_views/UserEncountersPage";
import type { MatchesFilters } from "@/app/(site)/users/components/matches/MatchesTable";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  UserTournamentsPage,
  UserTournamentsPageSkeleton
} from "@/app/(site)/users/_views/UserTournamentsPage";
import UserAchievementPage from "@/app/(site)/users/_views/UserAchievementPage";
import { SITE_NAME, SITE_URL_OBJ } from "@/config/site";
import { isDivisionGridRequired, isNotFoundError } from "@/lib/api/error";
import { decodePlayerSlug } from "@/lib/player";
import { Skeleton } from "@/components/ui/skeleton";
import UserTabsClient from "@/app/(site)/users/components/tabs/UserTabsClient";
import UserHeaderSkeleton from "@/app/(site)/users/components/header/UserHeaderSkeleton";
import { ProfileJsonLd } from "@/app/(site)/users/components/shared/profile-jsonld";
import UserProfileEmpty from "@/app/(site)/users/components/shared/UserProfileEmpty";
import { UsersMissingGrid } from "@/app/(site)/users/components/shared/UsersMissingGrid";
import { resolveStatsScope } from "@/lib/site/tenant-host";
import { resolveServerBrowsingDiscipline } from "@/lib/site/discipline-server";
import type { StatsScope } from "@/lib/site/stats-scope";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import { ServerBrowsingDiscipline } from "@/components/workspace/ServerBrowsingDiscipline";

// The route still renders dynamically (api-fetch reads the workspace cookie),
// but we no longer force `fetchCache: force-no-store` — public, workspace-scoped
// profile reads are tagged + revalidated in the Data Cache (see user.service),
// which cuts repeat TTFB and gives crawlers fast SSR HTML.

const USER_TABS = ["overview", "tournaments", "matches", "heroes", "maps", "achievements"] as const;
type UserTab = (typeof USER_TABS)[number];

type UserPageSearchParams = {
  tab?: string;
  discipline?: string | string[];
  tournamentId?: string;
  page?: string;
  selectedTournamentId?: string;
  achievementTournamentId?: string;
  // Matches-tab server-side filters
  mResult?: string;
  mStage?: string;
  mMvp1?: string;
  mLogs?: string;
  mOpp?: string;
};

/**
 * What every tab reads with: the viewing scope, the one game the profile shows (§2.3 concrete browsing) and the
 * workspace axis it is viewed on (host lock first) — the ontology role consumers name and draw roles from.
 */
type ProfileScope = { scope: StatsScope; discipline: string; axis: WorkspaceAxis };

const isUserTab = (value: string): value is UserTab => {
  return USER_TABS.includes(value as UserTab);
};

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
};

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const t = await getTranslations();
  try {
    const user = await userService.getUserByName(decodePlayerSlug(params.slug));

    const title = t("users.profile.meta.title", { name: user.name, siteName: SITE_NAME });
    const description = t("users.profile.meta.description", { name: user.name, siteName: SITE_NAME });
    const canonical = new URL(`/users/${params.slug}`, SITE_URL_OBJ).toString();

    // OG/Twitter images are supplied by the colocated opengraph-image route
    // (Next auto-injects og:image + twitter:image), so we don't set them here.
    return {
      title,
      description,
      alternates: { canonical },
      robots: { index: true, follow: true },
      openGraph: {
        title,
        description,
        url: canonical,
        type: "profile",
        siteName: SITE_NAME,
        locale: "en_US"
      },
      twitter: {
        card: "summary_large_image",
        title,
        description
      }
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        title: t("users.profile.meta.notFoundTitle", { siteName: SITE_NAME }),
        description: t("users.profile.meta.notFoundDescription", { siteName: SITE_NAME })
      };
    }
    throw error;
  }
}

const getUserAndProfile = cache(async (slug: string, scope: StatsScope, discipline: string) => {
  try {
    const user = await userService.getUserByName(decodePlayerSlug(slug));
    const profile = await userService.getUserProfile(user.id, discipline, scope);
    return { user, profile };
  } catch (error) {
    if (isNotFoundError(error)) {
      notFound();
    }
    throw error;
  }
});

type UserAndProfile = Awaited<ReturnType<typeof getUserAndProfile>>;

const UserHeaderSection = async ({
  userAndProfile,
  slug,
  profileScope
}: {
  userAndProfile: Promise<UserAndProfile>;
  slug: string;
  profileScope: ProfileScope;
}) => {
  const { user, profile } = await userAndProfile;
  const canonical = new URL(`/users/${slug}`, SITE_URL_OBJ).toString();
  return (
    <>
      <ProfileJsonLd user={user} profile={profile} url={canonical} />
      <UserHeader user={user} profile={profile} {...profileScope} />
    </>
  );
};

const UserOverviewTab = async ({
  userAndProfile,
  tournamentId,
  profileScope
}: {
  userAndProfile: Promise<UserAndProfile>;
  tournamentId?: number;
  profileScope: ProfileScope;
}) => {
  const { user, profile } = await userAndProfile;
  return <UserOverviewPage user={user} profile={profile} tournamentId={tournamentId} {...profileScope} />;
};

const UserTournamentsTab = async ({
  userAndProfile,
  profileScope
}: {
  userAndProfile: Promise<UserAndProfile>;
  profileScope: ProfileScope;
}) => {
  const { user, profile } = await userAndProfile;
  return <UserTournamentsPage user={user} profile={profile} {...profileScope} />;
};

const UserMatchesTab = async ({
  userAndProfile,
  page,
  filters,
  profileScope
}: {
  userAndProfile: Promise<UserAndProfile>;
  page: number;
  filters?: MatchesFilters;
  profileScope: ProfileScope;
}) => {
  const { user } = await userAndProfile;
  return <UserEncountersPage user={user} page={page} filters={filters} {...profileScope} />;
};

const UserMapsTab = async ({
  userAndProfile,
  profileScope
}: {
  userAndProfile: Promise<UserAndProfile>;
  profileScope: ProfileScope;
}) => {
  const { user } = await userAndProfile;
  return <UserMapsPage user={user} {...profileScope} />;
};

const UserHeroesTab = async ({
  userAndProfile,
  profileScope
}: {
  userAndProfile: Promise<UserAndProfile>;
  profileScope: ProfileScope;
}) => {
  const { user } = await userAndProfile;
  return <UserHeroesPage user={user} {...profileScope} />;
};

const UserAchievementsTab = async ({
  userAndProfile,
  selectedTournamentId,
  profileScope
}: {
  userAndProfile: Promise<UserAndProfile>;
  selectedTournamentId?: string;
  profileScope: ProfileScope;
}) => {
  const { user, profile } = await userAndProfile;
  return (
    <UserAchievementPage
      user={user}
      tournaments={profile.tournaments}
      selectedTournamentId={selectedTournamentId}
      scope={profileScope.scope}
      discipline={profileScope.discipline}
    />
  );
};

const resolveTabContent = ({
  activeTab,
  userAndProfile,
  tournamentId,
  pageNumber,
  achievementTournamentId,
  matchFilters,
  profileScope
}: {
  activeTab: UserTab;
  userAndProfile: Promise<UserAndProfile>;
  tournamentId?: number;
  pageNumber: number;
  achievementTournamentId?: string;
  matchFilters?: MatchesFilters;
  profileScope: ProfileScope;
}) => {
  switch (activeTab) {
    case "overview":
      return {
        value: "overview",
        fallback: <UserOverviewPageSkeleton />,
        content: (
          <UserOverviewTab
            userAndProfile={userAndProfile}
            tournamentId={tournamentId}
            profileScope={profileScope}
          />
        )
      };
    case "tournaments":
      return {
        value: "tournaments",
        fallback: <UserTournamentsPageSkeleton />,
        content: <UserTournamentsTab userAndProfile={userAndProfile} profileScope={profileScope} />
      };
    case "matches":
      return {
        value: "matches",
        fallback: <UserEncountersPageSkeleton />,
        content: (
          <UserMatchesTab
            userAndProfile={userAndProfile}
            page={pageNumber}
            filters={matchFilters}
            profileScope={profileScope}
          />
        )
      };
    case "maps":
      return {
        value: "maps",
        fallback: <Skeleton className="min-h-150 w-full rounded-xl" />,
        content: <UserMapsTab userAndProfile={userAndProfile} profileScope={profileScope} />
      };
    case "heroes":
      return {
        value: "heroes",
        fallback: <Skeleton className="min-h-150 w-full rounded-xl" />,
        content: <UserHeroesTab userAndProfile={userAndProfile} profileScope={profileScope} />
      };
    case "achievements":
      return {
        value: "achievements",
        fallback: <Skeleton className="min-h-150 w-full rounded-xl" />,
        content: (
          <UserAchievementsTab
            userAndProfile={userAndProfile}
            selectedTournamentId={achievementTournamentId}
            profileScope={profileScope}
          />
        )
      };
  }
};

/**
 * The profile body: either the tab strip (with its count badges) or — for a
 * player with no tournament history — the single empty-career panel. Both
 * branches need the resolved profile, so they share one Suspense boundary.
 */
const ProfileBody = async ({
  userAndProfile,
  activeTab,
  children
}: {
  userAndProfile: Promise<UserAndProfile>;
  activeTab: UserTab;
  children: React.ReactNode;
}) => {
  const { user, profile } = await userAndProfile;

  // Any tournament at all — including a league or one still in progress, whose
  // final placement (and therefore `tournaments_count`) does not exist yet.
  if (profile.tournaments.length === 0) {
    return <UserProfileEmpty name={user.name} />;
  }

  const charactersCount = profile.characters_count;
  const tournamentsCount = profile.tournaments_count ?? null;
  // Maps badge: not always available — approximate via maps_total
  const mapsTotal = profile.maps_total ?? null;

  return (
    <UserTabsClient
      activeTab={activeTab}
      badges={{
        tournaments: tournamentsCount,
        heroes: charactersCount,
        maps: mapsTotal
      }}
    >
      {children}
    </UserTabsClient>
  );
};

/**
 * The profile, or — when the viewed axis has no division grid for the game (the server's `division_grid_required`)
 * — the missing-grid notice in its place: the header and every tab read through the same refused context.
 */
const ProfileOrMissingGrid = async ({
  userAndProfile,
  profileScope,
  gameName,
  children
}: {
  userAndProfile: Promise<UserAndProfile>;
  profileScope: ProfileScope;
  gameName: string;
  children: React.ReactNode;
}) => {
  try {
    await userAndProfile;
  } catch (error) {
    if (!isDivisionGridRequired(error)) throw error;
    return <UsersMissingGrid discipline={profileScope.discipline} gameName={gameName} axis={profileScope.axis} />;
  }
  return children;
};

export default async function UserPage({
  params,
  searchParams
}: Readonly<{
  params: Promise<{ slug: string }>;
  searchParams: Promise<UserPageSearchParams>;
}>) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const [scope, browsing] = await Promise.all([
    resolveStatsScope(),
    resolveServerBrowsingDiscipline(resolvedSearchParams.discipline)
  ]);
  // Without the installed games there is no game to read: an error, never a guessed one.
  if (browsing.resolved === null) throw new Error("The installed games could not be read.");
  if (browsing.resolved.kind !== "concrete") {
    // Invalid/empty: the named value and the selector stand in for the profile; no game request is made.
    return <ServerBrowsingDiscipline initial={browsing.init} />;
  }
  const profileScope: ProfileScope = { scope, discipline: browsing.resolved.code, axis: browsing.init.axis };
  const userAndProfile = getUserAndProfile(resolvedParams.slug, scope, profileScope.discipline);

  const requestedTab = resolvedSearchParams.tab ?? "overview";
  const activeTab: UserTab = isUserTab(requestedTab) ? requestedTab : "overview";

  const tournamentId = toPositiveInt(resolvedSearchParams.tournamentId, 0) || undefined;
  const pageNumber = toPositiveInt(resolvedSearchParams.page, 1);
  const achievementTournamentId = resolvedSearchParams.achievementTournamentId;
  const { mResult, mStage, mMvp1, mLogs, mOpp } = resolvedSearchParams;
  const matchFilters: MatchesFilters = {
    result: mResult === "win" || mResult === "loss" || mResult === "draw" ? mResult : undefined,
    stage: mStage === "group" || mStage === "playoffs" || mStage === "finals" ? mStage : undefined,
    mvp1: mMvp1 === "1",
    hasLogs: mLogs === "1",
    opponent: mOpp || undefined
  };
  const tabContent = resolveTabContent({
    activeTab,
    userAndProfile,
    tournamentId,
    pageNumber,
    achievementTournamentId,
    matchFilters,
    profileScope
  });
  const gameName =
    browsing.init.disciplines?.find((entry) => entry.code === profileScope.discipline)?.name ?? profileScope.discipline;
  return (
    <>
      <div className="flex justify-end">
        <ServerBrowsingDiscipline initial={browsing.init} />
      </div>
      <Suspense
        fallback={
          <>
            <UserHeaderSkeleton />
            <UserTabsClient activeTab={activeTab}>
              <TabsContent value={tabContent.value} className="mt-0">
                {tabContent.fallback}
              </TabsContent>
            </UserTabsClient>
          </>
        }
      >
        <ProfileOrMissingGrid userAndProfile={userAndProfile} profileScope={profileScope} gameName={gameName}>
          <Suspense fallback={<UserHeaderSkeleton />}>
            <UserHeaderSection
              userAndProfile={userAndProfile}
              slug={resolvedParams.slug}
              profileScope={profileScope}
            />
          </Suspense>
          <Suspense
            fallback={
              <UserTabsClient activeTab={activeTab}>
                <Suspense fallback={tabContent.fallback}>
                  <TabsContent value={tabContent.value} className="mt-0">
                    {tabContent.content}
                  </TabsContent>
                </Suspense>
              </UserTabsClient>
            }
          >
            <ProfileBody userAndProfile={userAndProfile} activeTab={activeTab}>
              <Suspense fallback={tabContent.fallback}>
                <TabsContent value={tabContent.value} className="mt-0">
                  {tabContent.content}
                </TabsContent>
              </Suspense>
            </ProfileBody>
          </Suspense>
        </ProfileOrMissingGrid>
      </Suspense>
    </>
  );
}
