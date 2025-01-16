import React, { Suspense } from "react";
import tournamentService from "@/services/tournament.service";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import dayjs from "dayjs";
import { redirect } from "next/navigation";
import TournamentStandingsPage from "@/app/tournaments/pages/TournamentStandingsPage";
import { TournamentChallongeLink } from "@/app/tournaments/components/TournamentCard";
import { Sidebar, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Calendar, Home, Inbox, Search, Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import TournamentTeamsPage, {
  TournamentTeamsPageSkeleton
} from "@/app/tournaments/pages/TournamentTeamsPage";
import TournamentEncountersPage from "@/app/tournaments/pages/TournamentEncountersPage";
import TournamentHeroPlaytimePage from "@/app/tournaments/pages/TournamentHeroPlaytimePage";
import { Badge } from "@/components/ui/badge";

const items = [
  {
    title: "Overview",
    url: "?tab=overview",
    icon: Home,
    tab: "overview"
  },
  {
    title: "Teams",
    url: "?tab=teams",
    icon: Inbox,
    tab: "teams"
  },
  {
    title: "Matches",
    url: "?tab=matches",
    icon: Calendar,
    tab: "matches"
  },
  {
    title: "Heroes",
    url: "?tab=heroes",
    icon: Search,
    tab: "heroes"
  },
  {
    title: "Standings",
    url: "?tab=standings",
    icon: Settings,
    tab: "standings"
  }
];

const TournamentPage = async ({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: {
    tab: string;
    tournamentId: string;
    page: string;
    selectedTournamentId: string;
    search: string;
  };
}) => {
  let activeTab = searchParams.tab as string;
  const searchParamsObj = new URLSearchParams(searchParams);
  let searchParamsChanged = false;

  const tournamentId = Number(params.id);
  const page = parseInt(searchParams.page) || 1;
  const search = searchParams.search || "";
  const tournament = await tournamentService.get(tournamentId);

  if (!["overview", "teams", "matches", "heroes", "standings"].includes(activeTab)) {
    activeTab = "overview";
    searchParamsObj.set("tab", activeTab);
    searchParamsChanged = true;
  }

  if (searchParamsChanged) {
    redirect(`/tournaments/${params.id}?${searchParamsObj.toString()}`);
  }

  const start_date = dayjs(new Date(tournament.start_date)).format("MMM DD, YYYY");
  const end_date = dayjs(new Date(tournament.end_date)).format("MMM DD, YYYY");

  return (
    <div className="flex flex-row ml-4 h-full w-full">
      <Sidebar className="h-full bg-background" collapsible="none">
        <div
          data-sidebar="content"
          className="flex min-h-0 flex-1 flex-col group-data-[collapsible=icon]:overflow-hidden"
        >
          <SidebarMenu className="sticky top-[80px]">
            {items.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton className="h-10" asChild isActive={item.tab === activeTab}>
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>
      </Sidebar>
      <div className="mx-4 w-full">
        <Card className="rounded-lg shadow-lg hover:shadow-xl transition-shadow duration-300 mb-8">
          <CardHeader>
            <CardTitle className="scroll-m-20 text-2xl font-semibold tracking-tight">
              {tournament.name}
            </CardTitle>
            {tournament.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                {tournament.description}
              </p>
            )}
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 max-w-screen-xs1">
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Dates:</span>
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100">
                {start_date} - {end_date}
              </Badge>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Participants:</span>
              <Badge className="bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100">
                {tournament.participants_count || 0}
              </Badge>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Status:</span>
              <Badge
                className={
                  tournament.is_finished
                    ? "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100"
                    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100"
                }
              >
                {tournament.is_finished ? "Finished" : "Ongoing"}
              </Badge>
            </div>
            <TournamentChallongeLink tournament={tournament} />
          </CardContent>
        </Card>
        <Tabs value={activeTab}>
          <Suspense>
            <TabsContent value="overview">Overview</TabsContent>
          </Suspense>
          <Suspense fallback={<TournamentTeamsPageSkeleton />}>
            <TabsContent value="teams">
              <TournamentTeamsPage tournament={tournament} />
            </TabsContent>
          </Suspense>
          <TabsContent value="matches">
            <TournamentEncountersPage tournament={tournament} page={page} search={search} />
          </TabsContent>
          <TabsContent value="standings">
            <TournamentStandingsPage tournament={tournament} />
          </TabsContent>
          <TabsContent value="heroes">
            <TournamentHeroPlaytimePage tournament={tournament} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default TournamentPage;
