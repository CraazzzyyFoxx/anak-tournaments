import React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { UserOverviewPageSkeleton } from "@/app/users/pages/UserOverviewPage";

export default function Loading() {
  return (
    <>
      <div className="lg:ml-5 flex flex-row gap-4 items-center">
        <Skeleton className="h-[90px] w-[90px] rounded-xl" />
        <div className="flex flex-col gap-2">
          <div className="flex flex-row gap-1 items-center">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-7 w-24 hidden xs1:block" />
          </div>
          <Skeleton className="h-4 w-64" />
          <div className="pt-1 flex xs1:flex-row xs:flex-col xs1:gap-4 gap-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-7 w-40" />
          </div>
        </div>
      </div>

      <div className="mb-8 mt-6">
        <Skeleton className="h-10 w-[720px] mb-4" />
      </div>

      <UserOverviewPageSkeleton />
    </>
  );
}
