import React from "react";
import UserOverview, { UserOverviewSkeleton } from "@/app/users/components/UserOverview";
import { UserRoles, UserRolesSkeleton } from "@/app/users/components/UserRoles";
import UserLastTournamentCard, {
  UserLastTournamentCardSkeleton
} from "@/app/users/components/UserLastTournamentCard";
import { User, UserProfile } from "@/types/user.types";
import HeroPlaytimeChart from "@/components/HeroPlaytimeChart";
import { Card, CardHeader } from "@/components/ui/card";
import { Star } from "lucide-react";
import { TypographyH4 } from "@/components/ui/typography";
import userService from "@/services/user.service";
import { Skeleton } from "@/components/ui/skeleton";
import UserBestTeammates from "@/app/users/components/UserBestTeammates";

export interface OverviewPageProps {
  profile: UserProfile;
  user: User;
  tournamentId: number;
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
            <Skeleton className="p-0 pb-4 h-[412px]" />
          </Card>
        </div>
      </div>
    </>
  );
};

const UserOverviewPage = async ({ profile, tournamentId, user }: OverviewPageProps) => {
  const tournament = await userService.getUserTournament(user.id, tournamentId);
  const teammates = await userService.getUserBestTeammates(user.id);

  return (
    <div className="grid grid-cols-9 gap-8">
      <div className="grid gap-8 grid-cols-1 lg:grid-cols-2 xl:grid-cols-1 col-span-9 xl:col-span-2">
        <UserOverview profile={profile} />
        <UserRoles roles={profile.roles} />
        <UserBestTeammates className="xs:hidden md:block" teammates={teammates.results} />
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
            <div className="flex-1 px-2 pb-4 max-w-[840px]">
              <HeroPlaytimeChart heroes={profile.hero_statistics} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default UserOverviewPage;
