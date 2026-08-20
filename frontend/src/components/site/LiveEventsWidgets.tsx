import { getTranslations } from "next-intl/server";

/**
 * "N live · M upcoming" indicator dot + label — shared by the site home
 * page's platform-wide live events section and each workspace's own live
 * events section. Same markup on both surfaces; only the accent color
 * differs (the home page retints per tenant, a workspace page does not).
 */
export async function LiveUpcomingBadge({
  liveCount,
  upcomingCount,
  dotClassName,
  textClassName,
}: Readonly<{
  liveCount: number;
  upcomingCount: number;
  dotClassName: string;
  textClassName: string;
}>) {
  const t = await getTranslations();
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="relative flex h-2 w-2">
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotClassName}`}
        />
        <span className={`relative inline-flex rounded-full h-2 w-2 ${dotClassName}`} />
      </span>
      <span className={`text-[11px] font-bold tracking-[0.14em] uppercase ${textClassName}`}>
        {liveCount > 0 && t("statistics.liveCount", { count: liveCount })}
        {liveCount > 0 && upcomingCount > 0 && " · "}
        {upcomingCount > 0 && t("statistics.upcomingCount", { count: upcomingCount })}
      </span>
    </div>
  );
}

/** Loading placeholder for a 3-column grid of event cards. */
export function EventsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-44 rounded-xl border border-border/60 bg-card/30 animate-pulse" />
      ))}
    </div>
  );
}
