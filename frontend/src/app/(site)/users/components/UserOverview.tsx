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
    <li className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-lg font-bold leading-6 tabular-nums">{value}</span>
    </li>
  );
};

export const UserOverviewSkeleton = () => {
  return (
    <Card className="lg:h-110 flex flex-col">
      <CardHeader>
        <div className="flex flex-row gap-2">
          <Boxes />
          <TypographyH4>Overview</TypographyH4>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
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

const formatNullableValue = (
  value: number | null,
  formatter: (resolvedValue: number) => string = (resolvedValue) => `${resolvedValue}`
) => {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return formatter(value);
};

const UserOverview = ({ profile }: UserTournamentsProps) => {
  const winrate = profile.maps_total > 0 ? (profile.maps_won / profile.maps_total) * 100 : null;
  const proximity = profile.avg_closeness === null ? null : profile.avg_closeness * 100;

  return (
    <Card className="lg:h-110 flex flex-col">
      <CardHeader>
        <div className="flex flex-row gap-2">
          <Boxes />
          <TypographyH4>Overview</TypographyH4>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="divide-y divide-border/40">
          <UserOverviewLi label="Tournaments" value={`${profile.tournaments_count}`} />
          <UserOverviewLi label="Tournaments Won" value={`${profile.tournaments_won}`} />
          <UserOverviewLi label="Winrate" value={formatNullableValue(winrate, (value) => `${value.toFixed(2)}%`)} />
          <UserOverviewLi label="Maps" value={`${profile.maps_won}/${profile.maps_total}`} />
          <UserOverviewLi label="Proximity" value={formatNullableValue(proximity, (value) => `${value.toFixed(0)}%`)} />
          <UserOverviewLi label="Avg. Placement" value={formatNullableValue(profile.avg_placement)} />
          <UserOverviewLi
            label="Avg. Playoff Placement"
            value={formatNullableValue(profile.avg_playoff_placement)}
          />
          <UserOverviewLi label="Avg. Group Placement" value={formatNullableValue(profile.avg_group_placement)} />
        </ul>
      </CardContent>
    </Card>
  );
};

export default UserOverview;
