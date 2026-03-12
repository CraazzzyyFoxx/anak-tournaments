import React from "react";
import UserOverview, { UserOverviewSkeleton } from "@/app/(site)/users/components/UserOverview";
import { UserRoles, UserRolesSkeleton } from "@/app/(site)/users/components/UserRoles";
import UserLastTournamentCard, {
  UserLastTournamentCardSkeleton
} from "@/app/(site)/users/components/UserLastTournamentCard";
import { User, UserProfile } from "@/types/user.types";
import HeroPlaytimeChart from "@/components/HeroPlaytimeChart";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Star } from "lucide-react";
import { TypographyH4 } from "@/components/ui/typography";
import userService from "@/services/user.service";
import { Skeleton } from "@/components/ui/skeleton";
import UserBestTeammates from "@/app/(site)/users/components/UserBestTeammates";
import UserRecentEncountersCard from "@/app/(site)/users/components/UserRecentEncountersCard";

export interface OverviewPageProps {
  profile: UserProfile;
  user: User;
  tournamentId?: number;
}

export const UserOverviewPageSkeleton = () => {
  return (
    <>
      <div className="grid grid-cols-9 gap-8">
        <div className="flex flex-col gap-8 xl:col-span-2 md:col-span-3">
          <div className="grid gap-8">
            <UserOverviewSkeleton />
            <UserRolesSkeleton />
          </div>
        </div>
        <div className="flex flex-col gap-8 xl:col-span-7 md:col-span-6">
          <UserLastTournamentCardSkeleton />
          <Card>
            <CardHeader>
              <div className="flex flex-row gap-2">
                <Star />
                <TypographyH4>Most played heroes</TypographyH4>
              </div>
            </CardHeader>
            <CardContent className="p-0 pb-4">
              <Skeleton className="h-90 w-full" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-row justify-between items-center">
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-5 w-20" />
              </div>
              <Skeleton className="h-4 w-72" />
            </CardHeader>
            <CardContent className="p-0">
              <Skeleton className="h-65 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

const UserOverviewPage = async ({ profile, tournamentId, user }: OverviewPageProps) => {
  const resolvedTournamentId = tournamentId ?? profile.tournaments[0]?.id;
  const tournamentPromise = resolvedTournamentId
    ? userService.getUserTournament(user.id, resolvedTournamentId)
    : Promise.resolve(null);
  const teammatesPromise = userService.getUserBestTeammates(user.id);

  const [tournament, teammates] = await Promise.all([tournamentPromise, teammatesPromise]);

  return (
    <div className="grid grid-cols-9 gap-8">
      <div className="grid gap-8 grid-cols-1 lg:grid-cols-2 xl:grid-cols-1 col-span-9 xl:col-span-2">
        <UserOverview profile={profile} />
        <UserRoles roles={profile.roles} />
        <UserBestTeammates className="xs:hidden xl:block" teammates={teammates.results} />
      </div>
      <div className="col-span-9 xl:col-span-7">
        <div className="grid gap-8 grid-cols-1">
          <UserLastTournamentCard tournament={tournament} tournaments={profile.tournaments} />
          <UserBestTeammates className="xl:hidden block" teammates={teammates.results} />
          <Card>
            <CardHeader>
              <div className="flex flex-row gap-2">
                <Star />
                <TypographyH4>Most played heroes</TypographyH4>
              </div>
            </CardHeader>
            <CardContent className="p-0 pb-4">
              <div className="px-2 w-full">
                <HeroPlaytimeChart heroes={profile.hero_statistics} />
              </div>
            </CardContent>
          </Card>
          <UserRecentEncountersCard userId={user.id} userName={user.name} limit={5} />
        </div>
      </div>
    </div>
  );
};

export default UserOverviewPage;
