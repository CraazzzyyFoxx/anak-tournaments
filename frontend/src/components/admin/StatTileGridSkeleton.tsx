import { Skeleton } from "@/components/ui/skeleton";
import { StatTileGrid } from "./StatTile";

/**
 * Loading placeholder for a collector health dashboard: a status-bar-sized
 * skeleton above a `StatTileGrid` of four tile-sized skeletons. Shared by
 * every collector's health dashboard regardless of how many `StatTile`s it
 * actually renders once loaded.
 */
export function StatTileGridSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-full" />
      <StatTileGrid>
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </StatTileGrid>
    </div>
  );
}
