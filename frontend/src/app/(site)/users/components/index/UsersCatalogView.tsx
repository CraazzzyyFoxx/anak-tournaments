"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { CatalogEntityStrip } from "@/components/catalog/CatalogEntityImage";
import { PageStateCard } from "@/components/ui/page-state-card";
import { PlaceBadge } from "@/components/ui/place-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { UserCatalogEntry, UserOverviewRow } from "@/types/user.types";
import type { DivisionGridVersion } from "@/types/workspace.types";

import {
  CompareCheckbox,
  LastActive,
  PlayerAvatar,
  PlayerName,
  RolesCrests,
  WinrateCell
} from "./users-index.atoms";
import { ALPHABET } from "./users-index.model";
import type { CompareSelection } from "./UsersCompareBar";
import type { UsersIndexData } from "./useUsersIndexData";
import type { UsersIndexParamControls } from "./useUsersIndexParams";

/**
 * One player as a card. Shared by the catalog and by the table view below `md`,
 * where a ten-column table cannot be read at all.
 */
export function PlayerCard({
  user,
  grids,
  game,
  minEncounters,
  compare
}: Readonly<{
  user: UserCatalogEntry | UserOverviewRow;
  grids: DivisionGridVersion[] | undefined;
  /** The index's game and its role dictionary. */
  game: Pick<UsersIndexData, "discipline" | "ontology">;
  minEncounters: number;
  compare: CompareSelection;
}>) {
  const t = useTranslations();
  const selected = compare.isSelected(user.id);

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-3">
      <div className="flex items-start gap-2.5">
        <PlayerAvatar user={user} size={40} />
        <div className="min-w-0 flex-1">
          <PlayerName name={user.name} className="block" />
          <LastActive at={user.last_active_at} className="mt-0.5" />
        </div>
        <CompareCheckbox
          user={user}
          selected={selected}
          disabled={compare.isFull && !selected}
          onToggle={() => compare.toggle(user)}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <RolesCrests roles={user.roles} grids={grids} discipline={game.discipline} ontology={game.ontology} size={26} />
        <CatalogEntityStrip entities={user.top_characters.slice(0, 3).map((entry) => entry.character)} limit={3} />
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-[color:var(--aqt-border)] pt-2.5">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
            {t("users.list.table.tournaments")}
          </span>
          <span className="font-semibold tabular-nums">{user.tournaments_count}</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
            {t("users.list.table.winrate")}
          </span>
          <WinrateCell user={user} minEncounters={minEncounters} />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
            {t("users.list.table.bestPlacement")}
          </span>
          {user.best_placement ? (
            <PlaceBadge place={user.best_placement} />
          ) : (
            <span className="text-[color:var(--aqt-fg-faint)]">-</span>
          )}
        </div>
      </div>
    </article>
  );
}

/** A-Z browse: an alphabet jump bar over one card grid per initial. */
export function UsersCatalogView({
  controls,
  data,
  compare
}: Readonly<{
  controls: UsersIndexParamControls;
  data: UsersIndexData;
  compare: CompareSelection;
}>) {
  const t = useTranslations();
  const { letter, minEncounters } = controls.params;
  const { catalogQuery, availableLetters } = data;

  return (
    <section className="space-y-4">
      <nav
        aria-label={t("users.list.catalog.jumpTo")}
        className="flex flex-wrap items-center gap-1 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-2"
      >
        <span className="mr-1 text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
          {t("users.list.catalog.jumpTo")}
        </span>
        <LetterButton active={!letter} onClick={() => controls.setLetter(null)}>
          {t("common.all")}
        </LetterButton>
        {ALPHABET.map((alpha) => {
          const available = availableLetters.has(alpha);
          return (
            <LetterButton
              key={alpha}
              active={letter === alpha}
              disabled={!available && !catalogQuery.isPending}
              onClick={() => controls.setLetter(alpha)}
            >
              {alpha}
            </LetterButton>
          );
        })}
      </nav>

      {catalogQuery.isError ? (
        <PageStateCard
          state="error"
          description={(catalogQuery.error as Error)?.message || t("users.list.errors.catalog")}
          onAction={() => catalogQuery.refetch()}
        />
      ) : catalogQuery.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={`card-skeleton-${index}`} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : catalogQuery.data && catalogQuery.data.letters.length > 0 ? (
        <>
          {catalogQuery.data.letters.map((bucket) => (
            <div key={bucket.letter} className="space-y-2.5">
              <h2 className="flex items-baseline gap-2 font-display text-title">
                {bucket.letter}
                <span className="text-label tabular-nums text-[color:var(--aqt-fg-faint)]">
                  {bucket.count}
                </span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {bucket.users.map((entry) => (
                  <PlayerCard
                    key={entry.id}
                    user={entry}
                    grids={catalogQuery.data?.division_grids}
                    game={data}
                    minEncounters={minEncounters}
                    compare={compare}
                  />
                ))}
              </div>
              {bucket.users.length < bucket.count ? (
                <button
                  type="button"
                  onClick={() => controls.setLetter(bucket.letter)}
                  className="aqt-filter-chip"
                >
                  {t("users.list.catalog.showMore", {
                    count: bucket.count - bucket.users.length
                  })}
                </button>
              ) : null}
            </div>
          ))}
          <p className="text-label text-[color:var(--aqt-fg-faint)]">
            {t("users.list.catalog.showing", {
              count: catalogQuery.data.letters.reduce((acc, item) => acc + item.users.length, 0),
              total: catalogQuery.data.total
            })}
          </p>
        </>
      ) : (
        <PageStateCard
          state={controls.hasActiveFilters ? "filtered-empty" : "empty"}
          description={t("users.list.empty")}
          onAction={controls.hasActiveFilters ? controls.resetFilters : undefined}
        />
      )}
    </section>
  );
}

function LetterButton({
  active,
  disabled,
  onClick,
  children
}: Readonly<{
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}>) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded-[6px] px-1.5 text-caption outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]",
        active
          ? "bg-[color:color-mix(in_srgb,var(--aqt-teal)_14%,transparent)] text-[color:var(--aqt-teal)]"
          : "text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-2)] hover:text-[color:var(--aqt-fg)]",
        disabled && "cursor-not-allowed opacity-30 hover:bg-transparent"
      )}
    >
      {children}
    </button>
  );
}
