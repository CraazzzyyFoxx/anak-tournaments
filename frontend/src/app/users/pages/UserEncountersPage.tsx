import React, { Suspense } from "react";
import userService from "@/services/user.service";
import UserEncountersTable from "@/app/users/components/UserEncountersTable";
import { User } from "@/types/user.types";
import { Skeleton } from "@/components/ui/skeleton";

export const UserEncountersPageSkeleton = () => {
  return <Skeleton className="w-full h-[600px] rounded-xl" />;
};

export const UserEncountersPage = async ({ user, page }: { user: User; page: number }) => {
  const encounters = await userService.getUserEncounters(user.id, page);

  return (
    <Suspense fallback={<UserEncountersPageSkeleton />}>
      <UserEncountersTable encounters={encounters} InitialPage={page} />
    </Suspense>
  );
};
