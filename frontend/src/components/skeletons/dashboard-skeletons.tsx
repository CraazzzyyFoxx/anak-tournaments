import React from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallbacks for the dashboard-shaped pages (home, /statistics,
 * /workspace/[slug]). They live in `components/skeletons` rather than at the
 * `app/` root so they are importable without pretending to be a route module.
 */

export const PageHeaderSkeleton = () => {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
};

const StatCardSkeleton = () => {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] px-5 py-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="h-9 w-16" />
    </div>
  );
};

export const StatsGridSkeleton = () => {
  return (
    <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
      <StatCardSkeleton />
      <StatCardSkeleton />
      <StatCardSkeleton />
      <StatCardSkeleton />
    </div>
  );
};

export const ChartCardSkeleton = () => {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-64" />
      </CardHeader>
      <CardContent>
        <Skeleton className="aspect-video w-full" />
      </CardContent>
    </Card>
  );
};

export const TableCardSkeleton = () => {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-44" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-[92%]" />
        <Skeleton className="h-8 w-[96%]" />
        <Skeleton className="h-8 w-[90%]" />
        <Skeleton className="h-8 w-[95%]" />
        <Skeleton className="h-8 w-[88%]" />
      </CardContent>
    </Card>
  );
};

export const PopularHeroesCardSkeleton = () => {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <Skeleton className="h-6 w-44" />
      </CardHeader>
      <CardContent className="p-0 pb-2">
        <Skeleton className="h-160 w-full rounded-none" />
      </CardContent>
    </Card>
  );
};
