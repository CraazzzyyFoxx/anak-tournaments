import React from "react";
import dynamic from "next/dynamic";
import userService from "@/services/user.service";
import { User } from "@/types/user.types";
import { Skeleton } from "@/components/ui/skeleton";

const UserEncountersTable = dynamic(() => import("@/app/(site)/users/components/UserEncountersTable"));

export const UserEncountersPageSkeleton = () => {
  return <Skeleton className="w-full h-[600px] rounded-xl" />;
};

export const UserEncountersPage = async ({ user, page }: { user: User; page: number }) => {
  const encounters = await userService.getUserEncounters(user.id, page);

  return <UserEncountersTable encounters={encounters} InitialPage={page} />;
};
