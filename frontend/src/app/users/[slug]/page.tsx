import React, { Suspense } from "react";
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

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const user = await userService.getUserByName(params.slug);

  return {
    title: `${user.name} Overview | AQT`,
    description: `Overview for ${user.name} on AQT.`,
    openGraph: {
      title: `${user.name} Overview | AQT.`,
      description: `Overview for ${user.name} on AQT.`,
      url: "https://aqt.craazzzyyfoxx.me",
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

export default async function UserPage({
  params,
  searchParams
}: {
  params: { slug: string };
  searchParams: { tab: string; tournamentId: string; page: string; selectedTournamentId: string };
}) {
  let activeTab = searchParams.tab as string;
  const searchParamsObj = new URLSearchParams(searchParams);
  let searchParamsChanged = false;

  if (
    !["overview", "tournaments", "matches", "heroes", "maps", "achievements"].includes(activeTab)
  ) {
    activeTab = "overview";
    searchParamsObj.set("tab", activeTab);
    searchParamsChanged = true;
  }
  const user = await userService.getUserByName(params.slug);
  const profile = await userService.getUserProfile(user.id);

  if (!searchParams.tournamentId) {
    searchParamsObj.set("tournamentId", profile.tournaments[0].id.toString());
    searchParamsChanged = true;
  }

  if (!searchParams.page) {
    searchParamsObj.set("page", "1");
    searchParamsChanged = true;
  }

  if (searchParamsChanged) {
    redirect(`/users/${params.slug}?${searchParamsObj.toString()}`);
  }

  return (
    <>
      <UserHeader user={user} profile={profile} />
      <Tabs defaultValue="overview" value={activeTab}>
        <UserProfileTabList />
        <Suspense fallback={<UserOverviewPageSkeleton />}>
          <TabsContent value="overview">
            <UserOverviewPage
              user={user}
              profile={profile}
              tournamentId={Number(searchParams.tournamentId)}
            />
          </TabsContent>
        </Suspense>
        <Suspense fallback={<UserTournamentsPageSkeleton />}>
          <TabsContent value="tournaments">
            <UserTournamentsPage user={user} />
          </TabsContent>
        </Suspense>
        <Suspense fallback={<UserEncountersPageSkeleton />}>
          <TabsContent value="matches">
            <UserEncountersPage user={user} page={Number(searchParams.page)} />
          </TabsContent>
        </Suspense>
        <Suspense>
          <TabsContent value="maps">
            <UserMapsPage user={user} />
          </TabsContent>
        </Suspense>
        <Suspense>
          <TabsContent className="flex justify-center" value="heroes">
            <UserHeroesPage user={user} />
          </TabsContent>
        </Suspense>
        <Suspense>
          <TabsContent className="flex justify-center" value="achievements">
            <UserAchievementPage user={user} />
          </TabsContent>
        </Suspense>
      </Tabs>
    </>
  );
}
