import { Skeleton } from "@/components/ui/skeleton";

const ROWS = 8;

export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-10 w-full sm:w-[300px] md:w-[200px] lg:w-[300px]" />

      <div className="rounded-md border p-4">
        <div className="space-y-3">
          <div className="grid grid-cols-6 gap-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-18 justify-self-center" />
          </div>

          {Array.from({ length: ROWS }).map((_, index) => (
            <div key={index} className="grid grid-cols-6 items-center gap-4 border-t pt-3">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-5 w-6 justify-self-center rounded-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 py-4">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  );
}
