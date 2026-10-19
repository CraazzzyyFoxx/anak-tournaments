"use client";

import { useMemo } from "react";
import { Sword } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import statisticsService from "@/services/statistics.service";
import tournamentService from "@/services/tournament.service";
import { type SearchableImageOption } from "@/components/ui/searchable-image-select";

import {
  COL,
  StatKey,
  NUM_COLUMNS,
  getDefaultColumnKeys,
} from "../config/stat-columns";
import HeroCompareHero from "./HeroCompareHero";
import HeroLeaderboardFiltersCard from "./HeroLeaderboardFiltersCard";
import HeroLeaderboardTable from "./HeroLeaderboardTable";
import { characterStatsQueryKeys } from "@/lib/characters/query-keys";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";
import { useCatalogEntities, useCatalogSelection } from "@/hooks/useCatalogEntities";
import { Spinner } from "@/components/ui/spinner";
import { PageStateCard } from "@/components/ui/page-state-card";
import { useBrowsingDiscipline } from "@/hooks/useBrowsingDiscipline";
import { DisciplineSelector, DisciplineUnavailable } from "@/components/workspace/DisciplineSelector";
import { characterClass } from "@/lib/catalog/attrs";
import type { StatsScope } from "@/lib/site/stats-scope";
import { useWorkspaceStore } from "@/stores/workspace.store";

const HeroLeaderboardContent = ({ scope }: Readonly<{ scope: StatsScope }>) => {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const heroId = searchParams.get("hero_id") ? Number(searchParams.get("hero_id")) : undefined;
  const tournamentId = searchParams.get("tournament_id")
    ? Number(searchParams.get("tournament_id"))
    : undefined;

  const updateParams = (updates: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null) {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  const browsing = useBrowsingDiscipline({ allowsAll: false });
  const discipline = browsing.resolved?.kind === "concrete" ? browsing.resolved.code : null;
  const heroesQuery = useCatalogEntities(discipline, "character");
  // The id comes from the URL: it must belong to this game's catalog before its statistics are requested (§3.4).
  const heroSelection = useCatalogSelection(discipline, "character", heroId);
  const heroInvalid = heroSelection.status === "invalid";

  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const pickerWorkspaceId = scope === "all" ? "all" : currentWorkspaceId;
  const tournamentsQuery = useQuery({
    queryKey: tournamentQueryKeys.selectOptions(pickerWorkspaceId),
    queryFn: () => tournamentService.getAll(null, pickerWorkspaceId),
    staleTime: 5 * 60 * 1000,
  });

  const { axis } = browsing;
  const leaderboardQuery = useQuery({
    queryKey: characterStatsQueryKeys.leaderboard(axis, discipline ?? "", heroId, { stat: null, tournamentId }),
    enabled: discipline !== null && heroId !== undefined && heroSelection.status === "valid",
    queryFn: ({ signal }) =>
      statisticsService.getCharacterLeaderboard(discipline!, heroId!, {
        axis,
        tournamentId,
        perPage: -1,
        signal,
      }),
  });

  const heroOptions: SearchableImageOption[] = useMemo(
    () =>
      (heroesQuery.data ?? []).map((hero) => ({
        value: String(hero.id),
        label: hero.name,
        imageSrc: hero.image_path,
      })),
    [heroesQuery.data]
  );

  const selectedHero = heroSelection.entity ?? undefined;

  const selectedTournamentName = useMemo(
    () => tournamentsQuery.data?.results.find((t) => t.id === tournamentId)?.name,
    [tournamentsQuery.data, tournamentId]
  );

  const heroRole = characterClass(selectedHero);
  const defaultKeys = useMemo(() => getDefaultColumnKeys(heroRole), [heroRole]);

  // Memoized so the table's per-column bar scales and its memoized rows stay
  // stable across renders that only change hover state.
  const columnKeys = useMemo<StatKey[]>(
    () =>
      Array.from({ length: NUM_COLUMNS }, (_, i) => {
        const v = searchParams.get(`col${i}`);
        return v && COL[v] ? v : defaultKeys[i] ?? defaultKeys[0];
      }),
    [searchParams, defaultKeys]
  );

  // A single active column drives the shared row order of the whole table.
  const rawSortIndex = Number(searchParams.get("sort"));
  const sortIndex =
    Number.isInteger(rawSortIndex) && rawSortIndex >= 0 && rawSortIndex < NUM_COLUMNS
      ? rawSortIndex
      : 0;

  const dirParam = searchParams.get("dir");
  const sortDir: "asc" | "desc" =
    dirParam === "asc" || dirParam === "desc"
      ? dirParam
      : (COL[columnKeys[sortIndex]]?.ascending ?? false)
        ? "asc"
        : "desc";

  const handleColumnSelect = (colIndex: number, key: StatKey) => {
    const updates: Record<string, string | number | undefined> = { [`col${colIndex}`]: key };
    // Swapping the stat the sorted column shows resets to that stat's natural direction.
    if (colIndex === sortIndex) {
      updates.dir = (COL[key]?.ascending ?? false) ? "asc" : "desc";
    }
    updateParams(updates);
  };

  const handleSortChange = (colIndex: number) => {
    if (colIndex === sortIndex) {
      updateParams({ dir: sortDir === "asc" ? "desc" : "asc" });
      return;
    }
    updateParams({
      sort: colIndex,
      dir: (COL[columnKeys[colIndex]]?.ascending ?? false) ? "asc" : "desc",
    });
  };

  const handleResetColumns = () => {
    const updates: Record<string, undefined> = { sort: undefined, dir: undefined };
    for (let i = 0; i < NUM_COLUMNS; i++) {
      updates[`col${i}`] = undefined;
    }
    updateParams(updates);
  };

  // Only a hero CHECKED valid in this game has results: the key carries no game, so a cached row set of the same id
  // from another scope would otherwise stand in while the scoped lookup is pending, failed or refused.
  const heroChecked = heroSelection.status === "valid";
  const rows = heroChecked ? (leaderboardQuery.data?.results ?? []) : [];

  if (browsing.resolved?.kind === "invalid" || browsing.resolved?.kind === "empty") {
    return (
      <DisciplineUnavailable
        resolved={browsing.resolved}
        disciplines={browsing.disciplines ?? []}
        allowsAll={false}
        onSelect={browsing.select}
      />
    );
  }

  return (
    <div className="space-y-[22px]">
      {browsing.disciplines ? (
        <div className="flex justify-end">
          <DisciplineSelector
            disciplines={browsing.disciplines}
            value={discipline ?? undefined}
            allowsAll={false}
            onSelect={browsing.select}
          />
        </div>
      ) : null}
      <HeroCompareHero selectedHero={heroChecked ? selectedHero : undefined} rows={rows} />

      <HeroLeaderboardFiltersCard
        heroId={heroId}
        tournamentId={tournamentId}
        heroOptions={heroOptions}
        tournaments={tournamentsQuery.data?.results ?? []}
        isLoadingHeroes={heroesQuery.isLoading}
        isErrorHeroes={heroesQuery.isError}
        isLoadingTournaments={tournamentsQuery.isLoading}
        isErrorTournaments={tournamentsQuery.isError}
        onHeroChange={(v) => updateParams({ hero_id: v ? Number(v) : undefined })}
        onTournamentChange={(id) => updateParams({ tournament_id: id })}
        onResetColumns={handleResetColumns}
        resetDisabled={heroId === undefined}
      />

      {heroSelection.status === "error" ? (
        <PageStateCard
          state="error"
          description={t("users.heroesCompare.invalidHero.checkFailed")}
          onAction={heroSelection.refetch}
          actionLabel={t("common.retry")}
        />
      ) : heroInvalid ? (
        <PageStateCard
          state="error"
          title={t("users.heroesCompare.invalidHero.title")}
          description={t("users.heroesCompare.invalidHero.description", {
            game: browsing.disciplines?.find((entry) => entry.code === discipline)?.name ?? discipline ?? ""
          })}
        />
      ) : heroId !== undefined && !heroChecked ? (
        <div className="flex justify-center py-16" role="status" aria-busy="true">
          <Spinner />
        </div>
      ) : heroId === undefined ? (
        <div className="flex flex-col items-center justify-center gap-3.5 rounded-[var(--aqt-radius)] border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] py-[90px] text-center">
          <Sword aria-hidden className="h-10 w-10 text-[color:var(--aqt-fg-faint)] opacity-50" />
          <p className="max-w-sm text-sm leading-relaxed text-[color:var(--aqt-fg-dim)]">
            {t("users.heroesCompare.selectHeroPrompt")}
          </p>
        </div>
      ) : (
        <HeroLeaderboardTable
          selectedHero={selectedHero}
          selectedTournamentName={selectedTournamentName}
          tournamentId={tournamentId}
          rows={rows}
          isLoading={heroSelection.status === "loading" || leaderboardQuery.isLoading}
          columnKeys={columnKeys}
          sortIndex={sortIndex}
          sortDir={sortDir}
          onColumnSelect={handleColumnSelect}
          onSortChange={handleSortChange}
        />
      )}
    </div>
  );
};

export default HeroLeaderboardContent;
