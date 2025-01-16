import React from "react";
import { User } from "@/types/user.types";
import { UserTournamentsTable } from "@/app/users/components/UserTournamentsTable";
import { Skeleton } from "@/components/ui/skeleton";
import userService from "@/services/user.service";

export const UserTournamentsPageSkeleton = () => {
  return <Skeleton className="w-full h-full min-h-screen rounded-xl" />;
};

export const UserTournamentsPage = async ({ user }: { user: User }) => {
  const tournaments = await userService.getUserTournaments(user.id);

  return <UserTournamentsTable tournaments={tournaments} />;
};
