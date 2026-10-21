"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AchievementArt } from "@/components/achievements/AchievementArt";
import { PersonSection } from "@/components/admin/people/PersonSection";
import { EmptyNote } from "@/components/kit/EmptyNote";
import { PageStateCard } from "@/components/ui/page-state-card";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import userService from "@/services/user.service";
import { adminQueryKeys } from "@/lib/admin/query-keys";

const GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";
const TILE = "flex min-w-0 items-start gap-3 rounded-xl border border-[color:var(--aqt-overlay-border)] bg-[color:var(--aqt-overlay-1)] p-3";
/** Up to twenty tiles read at a glance; past that a reader looks one up. */
const SEARCH_ABOVE = 20;

/**
 * What this person has earned.
 *
 * Read-only: an achievement's rules, evaluation and overrides all belong to
 * the achievement, not to a holder, so every write lives on the achievement's
 * own page and this tab links there.
 */
export function PersonAchievementsTab({ personId }: Readonly<{ personId: number }>) {
  const t = useTranslations("adminPeople.achievements");
  const tCategory = useTranslations("adminAchievements.common.categoryValues");
  const [search, setSearch] = useState("");
  const achievementsQuery = useQuery({
    queryKey: adminQueryKeys.personAchievements(personId),
    queryFn: () => userService.getUserAchievements(personId)
  });

  // The most-earned first: that is what this person is known for.
  const achievements = useMemo(
    () =>
      (achievementsQuery.data ?? []).toSorted(
        (left, right) => right.count - left.count || left.name.localeCompare(right.name)
      ),
    [achievementsQuery.data]
  );
  const searchable = achievements.length > SEARCH_ABOVE;
  const needle = searchable ? search.trim().toLocaleLowerCase() : "";
  const shown = needle
    ? achievements.filter((achievement) =>
        `${achievement.name} ${achievement.slug}`.toLocaleLowerCase().includes(needle)
      )
    : achievements;

  let body: ReactNode;
  if (achievementsQuery.isError) {
    body = (
      <PageStateCard
        state="error"
        title={t("loadError")}
        onAction={() => void achievementsQuery.refetch()}
        actionLabel={t("retry")}
      />
    );
  } else if (achievementsQuery.isLoading) {
    body = (
      <ul aria-hidden className={GRID}>
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className={TILE}>
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2 py-0.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          </li>
        ))}
      </ul>
    );
  } else if (achievements.length === 0) {
    body = <EmptyNote>{t("empty")}</EmptyNote>;
  } else if (shown.length === 0) {
    body = <PageStateCard state="filtered-empty" onAction={() => setSearch("")} />;
  } else {
    body = (
      <ul className={GRID}>
        {shown.map((achievement) => {
          const tournaments = achievement.tournaments.map((tournament) => tournament.name).join(", ");
          return (
            <li key={achievement.id} className={TILE}>
              <AchievementArt achievement={achievement} sizes="40px" className="size-10 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/admin/achievements/${achievement.id}`}
                    title={achievement.name}
                    className="truncate text-body font-medium underline-offset-4 hover:underline"
                  >
                    {achievement.name}
                  </Link>
                  <span className="ml-auto shrink-0 text-caption tabular-nums text-muted-foreground">
                    {t("times", { count: achievement.count })}
                  </span>
                </div>
                {achievement.category ? (
                  <p className="text-caption text-muted-foreground">{tCategory(achievement.category)}</p>
                ) : null}
                {tournaments ? (
                  <p className="truncate text-caption text-muted-foreground" title={tournaments}>
                    {achievement.tournaments.map((tournament, index) => (
                      <span key={tournament.id}>
                        {index > 0 ? ", " : null}
                        <Link
                          href={`/admin/tournaments/${tournament.id}/overview`}
                          className="underline-offset-4 hover:text-foreground hover:underline"
                        >
                          {tournament.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <PersonSection
      title={t("title")}
      summary={achievementsQuery.isSuccess && achievements.length > 0 ? achievements.length : null}
      actions={
        searchable ? (
          <SearchField
            value={search}
            onValueChange={setSearch}
            label={t("search")}
            containerClassName="w-56"
          />
        ) : null
      }
    >
      {body}
    </PersonSection>
  );
}
