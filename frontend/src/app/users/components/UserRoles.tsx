import React from "react";
import { UserRole as UserRoleType } from "@/types/user.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Image from "next/image";
import { TypographyH4 } from "@/components/ui/typography";
import { Goal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export interface UserRolesProps {
  roles: UserRoleType[];
}

export interface UserRoleProps {
  role: UserRoleType;
}

export const UserRoleSkeleton = () => {
  return (
    <div className="flex flex-row gap-2 items-center">
      <div>
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-28" />
      </div>
    </div>
  );
};

export const UserRolesSkeleton = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <div className="flex flex-row gap-2">
            <Goal />
            <TypographyH4>Divisions</TypographyH4>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <UserRoleSkeleton />
        <UserRoleSkeleton />
        <UserRoleSkeleton />
      </CardContent>
    </Card>
  );
};

export const UserRole = async ({ role }: UserRoleProps) => {
  const winrate = role.maps_won / role.maps;
  return (
    <div className="flex flex-row gap-2 items-center">
      <div>
        <Image src={`/divisions/${role.division}.png`} width={40} height={40} alt="Division" />
      </div>
      <div className="flex flex-col">
        <small className="text-sm text-muted-foreground font-semibold">
          {role.role} ({role.tournaments})
        </small>
        <small className="text-sm font-semibold">{`${role.maps_won} wins - ${role.maps} maps`}</small>
        <small className="text-sm font-semibold">{`Winrate ${(winrate * 100).toFixed(2)}%`}</small>
      </div>
    </div>
  );
};

export const UserRoles = async ({ roles }: UserRolesProps) => {
  const TankRole = roles.find((role) => role.role === "Tank");
  const SupportRole = roles.find((role) => role.role === "Support");
  const DamageRole = roles.find((role) => role.role === "Damage");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <div className="flex flex-row gap-2">
            <Goal />
            <TypographyH4>Divisions</TypographyH4>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {TankRole && <UserRole role={TankRole} />}
        {DamageRole && <UserRole role={DamageRole} />}
        {SupportRole && <UserRole role={SupportRole} />}
      </CardContent>
    </Card>
  );
};
