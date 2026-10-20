"use client";

import { useMemo } from "react";
import { Sword } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import tournamentService from "@/services/tournament.service";
import { type SearchableImageOption } from "@/components/ui/searchable-image-select";

import HeroCompareHero from "./HeroCompareHero";
import HeroLeaderboardFiltersCard from "./HeroLeaderboardFiltersCard";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";
import { useCatalogEntities, useCatalogSelection } from "@/hooks/useCatalogEntities";
import { Spinner } from "@/components/ui/spinner";
import { PageStateCard } from "@/components/ui/page-state-card";
import ProfileWidget from "@/components/profile/ProfileWidget";
import { useGameScope } from "@/hooks/useGameScope";
import { GameScopeControl } from "@/components/workspace/GameScopeControl";
import { useGameBoundParams } from "@/components/workspace/scope-pill-store";
import type { StatsScope } from "@/lib/site/stats-scope";
import { useWorkspaceStore } from "@/stores/workspace.store";

/** The URL params the page itself owns; everything else (a module's board state) is the board's. */
const PAGE_PARAMS = ["discipline", "hero_id", "tournament_id"];
/**
 * The URL ids of one game (the page's own params but the game): a tab or a pill pick of another game
 * leaves them behind (spec §4.4, R5).
 */
const HERO_GAME_PARAMS = PAGE_PARAMS.filter((param) => param !== "discipline");

/**
 * Character comparison: the host resolves the browsed game, checks the picked character against that game's
 * catalog and owns the tournament scope; the game's module reads and draws the comparison (`characterCompare`,
 * `characterCompareSummary` profile slots). A game without a renderer is told so, and nothing is read for it.
 */
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

  const gameScope = useGameScope({ pageClass: "single" });
  useGameBoundParams(HERO_GAME_PARAMS);
  const discipline = gameScope.game;
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

  const { axis } = gameScope;

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

  // The board's own view state (columns, sort) lives in params the page does not own: a reset drops them all.
  const handleResetColumns = () => {
    const params = new URLSearchParams(
      [...searchParams.entries()].filter(([key]) => PAGE_PARAMS.includes(key))
    );
    router.replace(`${pathname}?${params.toString()}`);
  };

  // Only a hero CHECKED valid in this game is handed to the board: an id of another game is never read.
  const heroChecked = heroSelection.status === "valid";
  const compareProps = {
    character: heroChecked ? selectedHero : undefined,
    tournamentId,
    tournamentName: selectedTournamentName,
    axis
  };

  if (gameScope.resolution?.game.kind === "invalid" || gameScope.resolution?.game.kind === "empty") {
    return <GameScopeControl scope={gameScope} variant="single" dropParams={HERO_GAME_PARAMS} />;
  }

  return (
    <div className="space-y-[22px]">
      {gameScope.resolution?.tabs ? (
        <div className="flex justify-end">
          <GameScopeControl scope={gameScope} variant="single" dropParams={HERO_GAME_PARAMS} />
        </div>
      ) : null}
      <HeroCompareHero
        aside={
          discipline ? (
            <ProfileWidget
              axis={axis}
              discipline={discipline}
              slot="characterCompareSummary"
              props={compareProps}
              fallback={null}
            />
          ) : null
        }
      />

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
            game: gameScope.games?.find((entry) => entry.code === discipline)?.name ?? discipline ?? ""
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
      ) : discipline ? (
        <ProfileWidget
          axis={axis}
          discipline={discipline}
          slot="characterCompare"
          props={compareProps}
          fallback={
            <PageStateCard
              state="empty"
              title={gameScope.games?.find((entry) => entry.code === discipline)?.name ?? discipline}
              description={t("common.discipline.widgetUnsupported")}
            />
          }
        />
      ) : null}
    </div>
  );
};

export default HeroLeaderboardContent;
