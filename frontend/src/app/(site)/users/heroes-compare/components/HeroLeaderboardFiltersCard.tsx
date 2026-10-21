"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { TournamentCombobox } from "@/app/(site)/users/components/shared/TournamentCombobox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import SearchableImageSelect, { type SearchableImageOption } from "@/components/ui/searchable-image-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/** The sample floor's choices in the toolbar popover. */
export const MIN_GAMES_OPTIONS = [1, 3, 5, 10, 20] as const;

/**
 * The floor until the reader picks one. An all-time per-10 average needs a few games to mean anything, but one
 * tournament gives a player only a handful, so a tournament's board keeps everyone.
 */
export const defaultMinGames = (tournamentId: number | undefined): number => (tournamentId === undefined ? 5 : 1);

/** `?min_games=`: one of the offered floors, else the scope's default. */
export const parseMinGames = (value: string | null, tournamentId: number | undefined): number => {
  const parsed = Number(value);
  return value && (MIN_GAMES_OPTIONS as readonly number[]).includes(parsed) ? parsed : defaultMinGames(tournamentId);
};

interface HeroLeaderboardFiltersCardProps {
  /** The searchable picker: only for a roster too long for the rail, or when the rail's catalog failed to load. */
  showHeroPicker: boolean;
  heroId: number | undefined;
  heroOptions: SearchableImageOption[];
  isLoadingHeroes: boolean;
  isErrorHeroes: boolean;
  onHeroChange: (value: string | undefined) => void;
  tournamentId: number | undefined;
  tournaments: readonly { id: number; name: string }[];
  isLoadingTournaments: boolean;
  isErrorTournaments: boolean;
  onTournamentChange: (id: number | undefined) => void;
  minGames: number;
  onMinGamesChange: (value: number) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onResetColumns: () => void;
  resetDisabled: boolean;
}

const TRIGGER =
  "border-[color:var(--aqt-border-2)] bg-[hsl(0_0%_100%/0.025)] text-[color:var(--aqt-fg)] hover:bg-[hsl(0_0%_100%/0.04)]";

/** The board's one toolbar row: what is read (hero, tournament), who is ranked (the floor), who is shown (search). */
const HeroLeaderboardFiltersCard = ({
  showHeroPicker,
  heroId,
  heroOptions,
  isLoadingHeroes,
  isErrorHeroes,
  onHeroChange,
  tournamentId,
  tournaments,
  isLoadingTournaments,
  isErrorTournaments,
  onTournamentChange,
  minGames,
  onMinGamesChange,
  query,
  onQueryChange,
  onResetColumns,
  resetDisabled,
}: HeroLeaderboardFiltersCardProps) => {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-2.5 md:flex-row md:flex-wrap md:items-center md:gap-2">
      {showHeroPicker ? (
        <SearchableImageSelect
          value={heroId !== undefined ? String(heroId) : undefined}
          onValueChange={(v) => onHeroChange(v || undefined)}
          options={heroOptions}
          placeholder={t("users.heroesCompare.filters.selectHero")}
          searchPlaceholder={t("users.heroesCompare.filters.searchHeroes")}
          ariaLabel={t("users.heroesCompare.filters.heroLabel")}
          isLoading={isLoadingHeroes}
          disabled={isLoadingHeroes || isErrorHeroes}
          triggerClassName={cn(TRIGGER, "md:w-56")}
        />
      ) : null}

      <TournamentCombobox
        tournaments={tournaments}
        value={tournamentId}
        onValueChange={onTournamentChange}
        ariaLabel={t("users.heroesCompare.filters.tournamentScope")}
        isLoading={isLoadingTournaments}
        disabled={isLoadingTournaments || isErrorTournaments}
        triggerClassName={cn(TRIGGER, "md:w-60")}
      />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-start gap-2 border-[color:var(--aqt-border)] bg-[hsl(0_0%_100%/0.02)] text-[color:var(--aqt-fg)] hover:bg-[hsl(0_0%_100%/0.04)]"
          >
            <SlidersHorizontal aria-hidden className="size-3.5 shrink-0 opacity-70" />
            {t("users.heroesCompare.filters.minGamesValue", { value: String(minGames) })}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-2">
          <p className="text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
            {t("users.heroesCompare.filters.minGames")}
          </p>
          <ToggleGroup
            type="single"
            variant="pill"
            size="sm"
            value={String(minGames)}
            onValueChange={(next) => next && onMinGamesChange(Number(next))}
            aria-label={t("users.heroesCompare.filters.minGames")}
            className="w-full"
          >
            {MIN_GAMES_OPTIONS.map((option) => (
              <ToggleGroupItem key={option} value={String(option)} className="flex-1">
                {option}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-caption text-[color:var(--aqt-fg-dim)]">{t("users.heroesCompare.filters.minGamesHint")}</p>
        </PopoverContent>
      </Popover>

      <SearchField
        value={query}
        onValueChange={onQueryChange}
        label={t("users.heroesCompare.filters.searchPlayer")}
        placeholder={t("users.heroesCompare.filters.searchPlayer")}
        containerClassName="w-full md:ml-auto md:w-auto md:min-w-[12rem] md:max-w-xs md:flex-1"
        className="max-md:h-10"
      />

      <button
        type="button"
        onClick={onResetColumns}
        disabled={resetDisabled}
        title={t("users.heroesCompare.filters.resetColumnsTitle")}
        className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-[8px] px-3 text-xs font-semibold text-[color:var(--aqt-fg-muted)] outline-none transition-colors hover:bg-[hsl(0_0%_100%/0.05)] hover:text-[color:var(--aqt-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)] disabled:pointer-events-none disabled:opacity-40"
      >
        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
        {t("users.heroesCompare.filters.resetColumns")}
      </button>
    </div>
  );
};

export default HeroLeaderboardFiltersCard;
