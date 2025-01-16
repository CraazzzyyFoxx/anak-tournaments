import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { UserProfile } from "@/types/user.types";
import { TypographyH4 } from "@/components/ui/typography";
import { Boxes } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export interface UserTournamentsProps {
  profile: UserProfile;
}

const UserOverviewLi = ({ label, value }: { label: string; value: string }) => {
  return (
    <li className="flex items-center justify-between font-semibold">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </li>
  );
};

export const UserOverviewSkeleton = () => {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-row gap-2">
          <Boxes />
          <TypographyH4>Overview</TypographyH4>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          <Skeleton className="h-5 w-60" />
          <Skeleton className="h-5 w-60" />
          <Skeleton className="h-5 w-60" />
          <Skeleton className="h-5 w-60" />
          <Skeleton className="h-5 w-60" />
          <Skeleton className="h-5 w-60" />
          <Skeleton className="h-5 w-60" />
          <Skeleton className="h-5 w-60" />
        </ul>
      </CardContent>
    </Card>
  );
};

const UserOverview = ({ profile }: UserTournamentsProps) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-row gap-2">
          <Boxes />
          <TypographyH4>Overview</TypographyH4>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1">
          <UserOverviewLi label="Tournaments" value={`${profile.tournaments_count}`} />
          <UserOverviewLi label="Tournaments Won" value={`${profile.tournaments_won}`} />
          <UserOverviewLi
            label="Winrate"
            value={`${((profile.maps_won / profile.maps_total) * 100).toFixed(2)}%`}
          />
          <UserOverviewLi label="Maps" value={`${profile.maps_won}/${profile.maps_total}`} />
          <UserOverviewLi
            label="Proximity"
            value={`${(profile.avg_closeness * 100).toFixed(0)}%`}
          />
          <UserOverviewLi label="Avg. Placement" value={`${profile.avg_placement}`} />
          <UserOverviewLi
            label="Avg. Playoff Placement"
            value={`${profile.avg_playoff_placement}`}
          />
          <UserOverviewLi label="Avg. Group Placement" value={`${profile.avg_group_placement}`} />
        </ul>
      </CardContent>
    </Card>
  );
};

export default UserOverview;
