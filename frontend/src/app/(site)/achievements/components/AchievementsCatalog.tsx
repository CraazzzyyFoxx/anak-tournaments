"use client";

import { Suspense, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import achievementsService from "@/services/achievements.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { cn } from "@/lib/utils";
import { useQueryParams } from "@/hooks/useQueryParams";
import { FilterChip } from "@/components/ui/filter-chip";
import { PageStateCard } from "@/components/ui/page-state-card";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { RarityStrip } from "@/components/achievements/RarityStrip";
import type { Achievement, AchievementCategory } from "@/types/achievement.types";
import { classifyRarity, rarityVarClass, RARITY_ORDER, type Rarity } from "@/lib/achievements/rarity";
import { achievementQueryKeys } from "@/lib/achievements/query-keys";
import type { StatsScope } from "@/lib/site/stats-scope";

import AchievementsHero from "./AchievementsHero";
import AchievementTile from "./AchievementTile";

type SortBy = "rarity" | "name" | "count";

const SORT_VALUES: SortBy[] = ["rarity", "name", "count"];

const isRarity = (value: string | null): value is Rarity =>
  value != null && (RARITY_ORDER as string[]).includes(value);

const PageSkeleton = () => (
  <div className="aqt-player space-y-6">
    <Skeleton className="h-[220px] w-full rounded-2xl" />
    <Skeleton className="h-[86px] w-full rounded-xl" />
    <Skeleton className="h-[52px] w-full rounded-xl" />
    <div className="aqt-ach-tiles">
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-xl" />
      ))}
    </div>
  </div>
);

const TileSection = ({
  title,
  count,
  rarity,
  items
}: {
  title: string;
  count: ReactNode;
  rarity?: Rarity;
  items: Achievement[];
}) => (
  <section className={cn("space-y-3", rarity && rarityVarClass(rarity))}>
    <div className="flex items-baseline gap-3">
      <h2
        className={cn(
          "m-0 font-display text-title font-bold text-[color:var(--aqt-fg)]",
          rarity && "flex items-center gap-2.5 before:h-[0.9em] before:w-[3px] before:rounded-sm before:bg-[hsl(var(--rar))]"
        )}
      >
        {title}
      </h2>
      <span className="aqt-tnum text-caption text-[color:var(--aqt-fg-muted)]">{count}</span>
    </div>
    <div className="aqt-ach-tiles">
      {items.map((ach) => (
        <AchievementTile key={ach.id} achievement={ach} />
      ))}
    </div>
  </section>
);

const AchievementsCatalog = ({ scope }: Readonly<{ scope: StatsScope }>) => {
  const t = useTranslations();
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [] });

  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  // One value carries the workspace dimension of the read and its cache key.
  const scopeId = scope === "all" ? "all" : workspaceId;
  const workspaceName =
    scope === "all"
      ? t("common.scope.all")
      : workspaces.find((w) => w.id === workspaceId)?.name;

  // The games the current scope can hold: the workspaces' enabled disciplines, in first-seen order.
  const games = useMemo(() => {
    const scoped = scope === "all" ? workspaces : workspaces.filter((w) => w.id === workspaceId);
    return Array.from(new Set(scoped.flatMap((w) => w.disciplines_enabled)));
  }, [scope, workspaces, workspaceId]);
  // A game in the URL that the scope does not have is no filter at all.
  const gameParam = searchParams.get("game");
  const gameFilter = gameParam !== null && games.includes(gameParam) ? gameParam : null;

  const rarityParam = searchParams.get("rarity");
  const rarityFilter: Rarity | null = isRarity(rarityParam) ? rarityParam : null;
  const categoryFilter = (searchParams.get("category") as AchievementCategory | null) ?? null;
  const search = searchParams.get("q") ?? "";
  const sortParam = searchParams.get("sort") as SortBy | null;
  const sort: SortBy = sortParam && SORT_VALUES.includes(sortParam) ? sortParam : "rarity";

  const { data, isLoading, isError, refetch } = useQuery({
    // The game is part of the read and of its key: the reader pools and divides per game server-side.
    queryKey: achievementQueryKeys.all(scopeId, gameFilter),
    queryFn: () => achievementsService.getAll(1, -1, scopeId, gameFilter)
  });

  const results = useMemo(() => data?.results ?? [], [data?.results]);

  const { grouped, notEarned } = useMemo(() => {
    const buckets = Object.fromEntries(RARITY_ORDER.map((r) => [r, [] as Achievement[]])) as Record<
      Rarity,
      Achievement[]
    >;
    const unearned: Achievement[] = [];
    for (const ach of results) {
      // Nobody holds it yet: listed apart from the tiers, which describe owned shares.
      if ((ach.count ?? 0) > 0) buckets[classifyRarity(ach.rarity * 100)].push(ach);
      else unearned.push(ach);
    }
    return { grouped: buckets, notEarned: unearned };
  }, [results]);

  const counts = useMemo(
    () =>
      Object.fromEntries(RARITY_ORDER.map((r) => [r, grouped[r].length])) as Record<Rarity, number>,
    [grouped]
  );

  const categories = useMemo(() => {
    const present = new Set<AchievementCategory>();
    for (const ach of results) {
      if (ach.category) present.add(ach.category);
    }
    // Collate explicitly: these become filter chips, and bare `.sort()` orders
    // by UTF-16 code unit rather than by how the labels actually read.
    return Array.from(present).sort((a, b) => a.localeCompare(b));
  }, [results]);

  const stats = useMemo(() => {
    const earned = RARITY_ORDER.flatMap((r) => grouped[r]);
    return {
      total: results.length,
      rarest: earned.length > 0 ? Math.min(...earned.map((a) => a.rarity)) * 100 : null,
      unlocks: earned.reduce((sum, a) => sum + (a.count ?? 0), 0)
    };
  }, [grouped, results.length]);

  const refine = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list: Achievement[]): Achievement[] => {
      let out = list;
      if (categoryFilter) out = out.filter((a) => a.category === categoryFilter);
      if (q) {
        out = out.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            a.description_ru?.toLowerCase().includes(q) ||
            a.description_en?.toLowerCase().includes(q)
        );
      }
      return [...out].sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "count") return (b.count ?? 0) - (a.count ?? 0);
        return a.rarity - b.rarity; // rarest first
      });
    };
  }, [categoryFilter, search, sort]);

  const visibleGrouped = useMemo(
    () =>
      Object.fromEntries(
        RARITY_ORDER.map((r) => [r, rarityFilter && rarityFilter !== r ? [] : refine(grouped[r])])
      ) as Record<Rarity, Achievement[]>,
    [grouped, rarityFilter, refine]
  );

  // The tiers describe owned shares, so a tier filter has nothing to say about these.
  const visibleNotEarned = useMemo(
    () => (rarityFilter ? [] : refine(notEarned)),
    [notEarned, rarityFilter, refine]
  );

  const visibleCount =
    RARITY_ORDER.reduce((sum, r) => sum + visibleGrouped[r].length, 0) + visibleNotEarned.length;

  const filtersActive = rarityFilter !== null || categoryFilter !== null || search.trim() !== "";

  const clearFilters = () => setParams({ rarity: null, category: null, q: null });
  // Keys are built from a game code the statically typed `t` cannot know; an unknown game reads as its code.
  const looseT = t as unknown as { (key: string): string; has(key: string): boolean };
  const gameLabel = (game: string) => (looseT.has(`achievements.game.${game}`) ? looseT(`achievements.game.${game}`) : game);

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="aqt-player">
        <PageStateCard
          state="error"
          description={t("common.loadError")}
          onAction={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="aqt-player space-y-6">
      <AchievementsHero
        workspaceName={workspaceName}
        total={stats.total}
        rarestPct={stats.rarest}
        unlocks={stats.unlocks}
      />

      <RarityStrip
        values={counts}
        active={rarityFilter}
        onToggle={(rarity) => setParams({ rarity })}
      />

      {/* Same toolbar shape as /tournaments: chips scroll on phones, one row from md. */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-2.5 md:flex-row md:flex-wrap md:items-center md:gap-2">
        {categories.length > 0 ? (
          <div
            role="group"
            aria-label={t("achievements.categoryFilter")}
            className="-mx-2.5 flex items-center gap-2 overflow-x-auto px-2.5 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden"
          >
            <FilterChip
              active={categoryFilter === null}
              className="shrink-0"
              onClick={() => setParams({ category: null })}
            >
              {t("common.all")}
            </FilterChip>
            {categories.map((cat) => (
              <FilterChip
                key={cat}
                active={categoryFilter === cat}
                className="shrink-0"
                onClick={() => setParams({ category: categoryFilter === cat ? null : cat })}
              >
                {t(`achievements.category.${cat}`)}
              </FilterChip>
            ))}
          </div>
        ) : null}

        {games.length > 1 ? (
          <div
            role="group"
            aria-label={t("achievements.gameFilter")}
            className="flex shrink-0 items-center gap-2"
          >
            <FilterChip active={gameFilter === null} onClick={() => setParams({ game: null })}>
              {t("achievements.game.all")}
            </FilterChip>
            {games.map((game) => (
              <FilterChip
                key={game}
                active={gameFilter === game}
                onClick={() => setParams({ game: gameFilter === game ? null : game })}
              >
                {gameLabel(game)}
              </FilterChip>
            ))}
          </div>
        ) : null}

        <SearchField
          value={search}
          onValueChange={(value) => setParams({ q: value })}
          label={t("common.searchLabel")}
          placeholder={t("achievements.searchPlaceholder")}
          containerClassName="md:ml-auto md:w-[240px]"
          className="max-md:h-10"
        />

        <div className="flex items-center gap-3">
          <Select value={sort} onValueChange={(v) => setParams({ sort: v === "rarity" ? null : v })}>
            <SelectTrigger
              aria-label={t("common.sortBy")}
              className="h-8 w-auto min-w-[170px] gap-2 border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-2)] text-caption text-[color:var(--aqt-fg-muted)] shadow-none hover:border-[color:var(--aqt-border-2)] focus:ring-0 focus:ring-offset-0 max-md:h-10 max-md:flex-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rarity">{t("users.achievements.sort.rarity")}</SelectItem>
              <SelectItem value="name">{t("users.achievements.sort.name")}</SelectItem>
              <SelectItem value="count">{t("achievements.sortHolders")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="aqt-tnum shrink-0 text-caption tabular-nums text-[color:var(--aqt-fg-dim)]" aria-live="polite">
            {t("achievements.results", { count: visibleCount })}
          </span>
        </div>
      </div>

      {visibleCount === 0 ? (
        <PageStateCard
          state={filtersActive ? "filtered-empty" : "empty"}
          title={t("achievements.empty.title")}
          description={filtersActive ? undefined : t("achievements.empty.body")}
          onAction={filtersActive ? clearFilters : undefined}
        />
      ) : (
        <>
          {RARITY_ORDER.map((r) =>
            visibleGrouped[r].length > 0 ? (
              <TileSection
                key={r}
                rarity={r}
                title={t(`achievements.rarityName.${r}`)}
                count={t("achievements.sectionCount", { count: visibleGrouped[r].length })}
                items={visibleGrouped[r]}
              />
            ) : null
          )}
          {visibleNotEarned.length > 0 ? (
            <TileSection
              title={t("achievements.notEarned.title")}
              count={t("achievements.sectionCount", { count: visibleNotEarned.length })}
              items={visibleNotEarned}
            />
          ) : null}
        </>
      )}
    </div>
  );
};

const AchievementsCatalogPage = ({ scope }: Readonly<{ scope: StatsScope }>) => (
  <Suspense fallback={<PageSkeleton />}>
    <AchievementsCatalog scope={scope} />
  </Suspense>
);

export default AchievementsCatalogPage;
