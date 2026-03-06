import React from "react";
import dynamic from "next/dynamic";
import { User } from "@/types/user.types";
import { Skeleton } from "@/components/ui/skeleton";
import userService from "@/services/user.service";

const UserTournamentsTable = dynamic(
  () => import("@/app/users/components/UserTournamentsTable").then((mod) => mod.UserTournamentsTable)
);

export const UserTournamentsPageSkeleton = () => {
  return <Skeleton className="w-full h-full min-h-screen rounded-xl" />;
};

export const UserTournamentsPage = async ({ user }: { user: User }) => {
  const tournaments = await userService.getUserTournaments(user.id);

  return <UserTournamentsTable tournaments={tournaments} />;
};
