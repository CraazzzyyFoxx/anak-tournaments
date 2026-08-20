
import { UserOverviewPageSkeleton } from "@/app/(site)/users/_views/UserOverviewPage";
import UserHeaderSkeleton from "@/app/(site)/users/components/header/UserHeaderSkeleton";

/**
 * Route-level loading state. Mirrors the live layout in the Editorial-Tactical
 * system: the profile hero skeleton, then the sticky tab-bar treatment matching
 * `UserProfileTabList` (token card + hairline, not shadcn backdrop-blur).
 */
export default function Loading() {
  return (
    <>
      <UserHeaderSkeleton />

      {/* Gutter and offset must track UserTabsClient exactly, or the loading
          state reintroduces the 375px horizontal scroll the live bar just lost. */}
      <div className="sticky top-[var(--aqt-header-h)] z-40 -mx-4 bg-[color:var(--aqt-bg)] px-4 pb-4 pt-3 md:-mx-6 md:px-6 xl:-mx-10 xl:px-10">
        <div className="flex w-full max-w-[560px] items-center gap-2 overflow-hidden rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] px-2 py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="h-7 flex-1 animate-pulse rounded-lg bg-[color:var(--aqt-card-2)]"
            />
          ))}
        </div>
      </div>

      <div className="pt-6">
        <UserOverviewPageSkeleton />
      </div>
    </>
  );
}
