import React, { Suspense, cache } from "react";
import userService from "@/services/user.service";
import UserHeader from "@/app/users/components/UserHeader";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import UserOverviewPage, { UserOverviewPageSkeleton } from "@/app/users/pages/UserOverviewPage";
import UserMapsPage from "@/app/users/pages/UserMapsPage";
import UserProfileTabList from "@/app/users/components/UserProfileTabList";
import { redirect } from "next/navigation";
import UserHeroesPage from "@/app/users/pages/UserHeroesPage";
import {
  UserEncountersPageSkeleton,
  UserEncountersPage
} from "@/app/users/pages/UserEncountersPage";
import { Metadata } from "next";
import {
  UserTournamentsPage,
  UserTournamentsPageSkeleton
} from "@/app/users/pages/UserTournamentsPage";
import UserAchievementPage from "@/app/users/pages/UserAchievementPage";
import { SITE_NAME } from "@/config/site";
import { Skeleton } from "@/components/ui/skeleton";

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const user = await userService.getUserByName(params.slug);

  return {
    title: `${user.name} Overview | ${SITE_NAME}`,
    description: `Overview for ${user.name} on ${SITE_NAME}.`,
    openGraph: {
      title: `${user.name} Overview | on ${SITE_NAME}.`,
      description: `Overview for ${user.name} on ${SITE_NAME}.`,
      url: SITE_NAME,
      type: "website",
      siteName: "AQT",
      images: [
        {
          url: `/avatar/${user.id % 10}.png`,
          width: 1200,
          height: 630
        }
      ],
      locale: "en_US"
    }
  };
}

const getUserAndProfile = cache(async (slug: string) => {
  const user = await userService.getUserByName(slug);
  const profile = await userService.getUserProfile(user.id);
  return { user, profile };
});

const UserHeaderSkeleton = () => {
  return (
    <div className="lg:ml-5 flex flex-row gap-4 items-center">
      <Skeleton className="h-24 w-24 rounded-xl" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-64" />
        <div className="pt-1 flex xs1:flex-row xs:flex-col xs1:gap-4 gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-7 w-40" />
        </div>
      </div>
    </div>
  );
};

const UserHeaderSection = async ({ slug }: { slug: string }) => {
  const { user, profile } = await getUserAndProfile(slug);
  return <UserHeader user={user} profile={profile} />;
};

const UserOverviewTab = async ({
  slug,
  tournamentId
}: {
  slug: string;
  tournamentId?: number;
}) => {
  const { user, profile } = await getUserAndProfile(slug);
  return <UserOverviewPage user={user} profile={profile} tournamentId={tournamentId} />;
};

const UserTournamentsTab = async ({ slug }: { slug: string }) => {
  const { user } = await getUserAndProfile(slug);
  return <UserTournamentsPage user={user} />;
};

const UserMatchesTab = async ({ slug, page }: { slug: string; page: number }) => {
  const { user } = await getUserAndProfile(slug);
  return <UserEncountersPage user={user} page={page} />;
};

const UserMapsTab = async ({ slug }: { slug: string }) => {
  const { user } = await getUserAndProfile(slug);
  return <UserMapsPage user={user} />;
};

const UserHeroesTab = async ({ slug }: { slug: string }) => {
  const { user } = await getUserAndProfile(slug);
  return <UserHeroesPage user={user} />;
};

const UserAchievementsTab = async ({ slug }: { slug: string }) => {
  const { user } = await getUserAndProfile(slug);
  return <UserAchievementPage user={user} />;
};

export default async function UserPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    tab?: string;
    tournamentId?: string;
    page?: string;
    selectedTournamentId?: string;
  }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;

  const activeTab = resolvedSearchParams.tab ?? "overview";
  const allowedTabs = ["overview", "tournaments", "matches", "heroes", "maps", "achievements"];

  if (!allowedTabs.includes(activeTab)) {
    const searchParamsObj = new URLSearchParams();
    for (const [key, value] of Object.entries(resolvedSearchParams)) {
      if (typeof value === "string") {
        searchParamsObj.set(key, value);
      }
    }
    searchParamsObj.set("tab", "overview");
    redirect(`/users/${resolvedParams.slug}?${searchParamsObj.toString()}`);
  }

  const tournamentIdRaw = resolvedSearchParams.tournamentId;
  const tournamentId = tournamentIdRaw ? Number(tournamentIdRaw) : undefined;
  const pageRaw = resolvedSearchParams.page;
  const pageNumber = Math.max(1, Number(pageRaw ?? "1") || 1);

  return (
    <>
      <Suspense fallback={<UserHeaderSkeleton />}>
        <UserHeaderSection slug={resolvedParams.slug} />
      </Suspense>
      <Tabs defaultValue="overview" value={activeTab}>
        <UserProfileTabList />

        {activeTab === "overview" && (
          <Suspense fallback={<UserOverviewPageSkeleton />}>
            <TabsContent value="overview">
              <UserOverviewTab slug={resolvedParams.slug} tournamentId={tournamentId} />
            </TabsContent>
          </Suspense>
        )}

        {activeTab === "tournaments" && (
          <Suspense fallback={<UserTournamentsPageSkeleton />}>
            <TabsContent value="tournaments">
              <UserTournamentsTab slug={resolvedParams.slug} />
            </TabsContent>
          </Suspense>
        )}

        {activeTab === "matches" && (
          <Suspense fallback={<UserEncountersPageSkeleton />}>
            <TabsContent value="matches">
              <UserMatchesTab slug={resolvedParams.slug} page={pageNumber} />
            </TabsContent>
          </Suspense>
        )}

        {activeTab === "maps" && (
          <Suspense fallback={<Skeleton className="w-full h-150 rounded-xl" />}>
            <TabsContent value="maps">
              <UserMapsTab slug={resolvedParams.slug} />
            </TabsContent>
          </Suspense>
        )}

        {activeTab === "heroes" && (
          <Suspense fallback={<Skeleton className="w-full h-150 rounded-xl" />}>
            <TabsContent className="flex justify-center" value="heroes">
              <UserHeroesTab slug={resolvedParams.slug} />
            </TabsContent>
          </Suspense>
        )}

        {activeTab === "achievements" && (
          <Suspense fallback={<Skeleton className="w-full h-150 rounded-xl" />}>
            <TabsContent className="flex justify-center" value="achievements">
              <UserAchievementsTab slug={resolvedParams.slug} />
            </TabsContent>
          </Suspense>
        )}
      </Tabs>
    </>
  );
}
