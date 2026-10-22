"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { CompareScope } from "@/app/(site)/users/compare/types";
import { parseOptionalInt, getMapIconSrc } from "@/app/(site)/users/compare/utils";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { useRoleName } from "@/hooks/useRoleName";
import { registrationRoles, showsRoles, type RoleOntology } from "@/lib/roster/ontology";
import type { DivisionGridLike } from "@/lib/divisions/grid";
import { UserSearchCombobox } from "@/components/kit/ServerSearchCombobox";
import SearchableImageSelect, {
  type SearchableImageOption,
} from "@/components/ui/searchable-image-select";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DivisionCombobox } from "@/components/DivisionCombobox";
import { TournamentCombobox } from "@/components/tournaments/TournamentCombobox";
import type { CatalogEntityRead } from "@/types/catalog.types";
import { Tournament } from "@/types/tournament.types";

interface CompareFiltersPanelProps {
  subjectUserId?: number;
  targetUserId?: number;
  scope: CompareScope;
  /** A rated role code of the browsed game. */
  role?: string;
  ontology?: RoleOntology | null;
  divMin?: number;
  divMax?: number;
  tournamentId?: number;
  leftHeroId?: number;
  rightHeroId?: number;
  mapId?: number;
  isTargetBaseline: boolean;
  selectedSubjectName?: string;
  selectedTargetName?: string;
  subjectNameLoading?: boolean;
  targetNameLoading?: boolean;
  /** The grid the backend reads div_min/div_max against. */
  divisionGrid: DivisionGridLike;
  heroes: CatalogEntityRead[];
  maps: CatalogEntityRead[];
  tournaments: Tournament[];
  isHeroesLoading: boolean;
  isHeroesError: boolean;
  isMapsLoading: boolean;
  isMapsError: boolean;
  isTournamentsLoading: boolean;
  isTournamentsError: boolean;
  updateParams: (updates: Record<string, string | number | undefined>) => void;
}

const FilterField = ({ label, children }: Readonly<{ label: string; children: ReactNode }>) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <span className="text-xs font-semibold text-[color:var(--aqt-fg-muted)]">{label}</span>
    {children}
  </div>
);

const CompareFiltersPanel = ({
  subjectUserId,
  targetUserId,
  scope,
  role,
  ontology,
  divMin,
  divMax,
  tournamentId,
  leftHeroId,
  rightHeroId,
  mapId,
  isTargetBaseline,
  selectedSubjectName,
  selectedTargetName,
  subjectNameLoading = false,
  targetNameLoading = false,
  divisionGrid,
  heroes,
  maps,
  tournaments,
  isHeroesLoading,
  isHeroesError,
  isMapsLoading,
  isMapsError,
  isTournamentsLoading,
  isTournamentsError,
  updateParams
}: CompareFiltersPanelProps) => {
  const t = useTranslations();
  const nameOf = useRoleName();
  const heroOptions: SearchableImageOption[] = useMemo(
    () =>
      heroes.map((hero) => ({
        value: String(hero.id),
        label: hero.name,
        imageSrc: hero.image_path,
      })),
    [heroes]
  );

  const mapOptions: SearchableImageOption[] = useMemo(
    () =>
      maps.map((map) => ({
        value: String(map.id),
        label: map.name,
        imageSrc: getMapIconSrc(map),
      })),
    [maps]
  );

  // The browsed game's own rated roles; the cohort never filters on the open slot.
  const roleOptions: SearchableImageOption[] = registrationRoles(ontology).map((node) => ({
    value: node.code,
    label: nameOf(node),
    icon: <PlayerRoleIcon role={{ dimension: node.dimension, role: node.code }} ontology={ontology} size={20} decorative />
  }));

  const isHeroScope = scope === "hero";

  const setDivisionBound = (bound: "min" | "max", division: number | undefined) => {
    let nextMin = bound === "min" ? division : divMin;
    let nextMax = bound === "max" ? division : divMax;
    // The API takes division numbers and rejects min > max; a crossed pick
    // swaps the bounds instead of producing a request that can only fail.
    if (nextMin !== undefined && nextMax !== undefined && nextMin > nextMax) {
      [nextMin, nextMax] = [nextMax, nextMin];
    }
    updateParams({ div_min: nextMin, div_max: nextMax });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <Eyebrow as="h2" className="aqt-tnum">{t("common.playersLabel")}</Eyebrow>
        <div className="grid gap-3 md:grid-cols-2">
          <FilterField label={t("users.compare.selectedUser")}>
            <UserSearchCombobox
              value={subjectUserId}
              selectedLabel={selectedSubjectName}
              labelLoading={subjectNameLoading}
              placeholder={t("users.compare.selectSubjectUser")}
              triggerAriaLabel={t("users.compare.selectedUser")}
              clearLabel={null}
              variant="toolbar"
              size="sm"
              onSelect={(user) => {
                if (user) updateParams({ user_id: user.id });
              }}
            />
          </FilterField>

          <FilterField label={t("users.compare.compareAgainst")}>
            <UserSearchCombobox
              value={targetUserId}
              selectedLabel={selectedTargetName}
              labelLoading={targetNameLoading}
              placeholder={t("users.compare.allPlayersAverage")}
              triggerAriaLabel={t("users.compare.compareAgainst")}
              clearLabel={t("users.compare.compareWithAllAvg")}
              variant="toolbar"
              size="sm"
              onSelect={(user) =>
                updateParams(
                  user
                    ? { target_user_id: user.id, div_min: undefined, div_max: undefined }
                    : { target_user_id: undefined }
                )
              }
            />
          </FilterField>
        </div>
      </section>

      <section className="space-y-3 border-t border-[color:var(--aqt-border)] pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow as="h2" className="aqt-tnum">{t("users.compare.filters.title")}</Eyebrow>
          <ToggleGroup
            type="single"
            variant="pill"
            size="sm"
            value={scope}
            onValueChange={(value) => updateParams({ scope: value as CompareScope })}
            aria-label={t("users.compare.filters.compareScope")}
          >
            <ToggleGroupItem value="overall">
              {t("users.compare.filters.overallPerformance")}
            </ToggleGroupItem>
            <ToggleGroupItem value="hero">
              {t("users.compare.filters.heroMapPerformance")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* A one-role game has nothing to filter by. */}
          {showsRoles(ontology) ? (
            <FilterField label={t("users.compare.filters.roleFilter")}>
              <SearchableImageSelect
                value={role}
                onValueChange={(value) => updateParams({ role: value })}
                options={roleOptions}
                placeholder={t("users.compare.allRoles")}
                ariaLabel={t("users.compare.filters.roleFilter")}
                disabled={isTargetBaseline}
              />
            </FilterField>
          ) : null}

          <FilterField label={t("users.compare.filters.divisionMin")}>
            <DivisionCombobox
              value={divMin}
              onValueChange={(division) => setDivisionBound("min", division)}
              grid={divisionGrid}
              ariaLabel={t("users.compare.filters.divisionMin")}
              disabled={isTargetBaseline}
            />
          </FilterField>

          <FilterField label={t("users.compare.filters.divisionMax")}>
            <DivisionCombobox
              value={divMax}
              onValueChange={(division) => setDivisionBound("max", division)}
              grid={divisionGrid}
              ariaLabel={t("users.compare.filters.divisionMax")}
              disabled={isTargetBaseline}
            />
          </FilterField>

          <FilterField label={t("common.tournament")}>
            <TournamentCombobox
              tournaments={tournaments}
              value={tournamentId}
              onValueChange={(id) => updateParams({ tournament_id: id })}
              ariaLabel={t("common.tournament")}
              isLoading={isTournamentsLoading}
              disabled={isTournamentsLoading || isTournamentsError}
            />
          </FilterField>
        </div>

        {isTargetBaseline ? (
          <p className="text-xs text-[color:var(--aqt-fg-dim)]">
            {t("users.compare.filters.cohortLockedHint")}
          </p>
        ) : null}
      </section>

      {/* Hero & map: revealed with the scope; `inert` keeps the collapsed
          pickers out of the tab order. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none"
        style={{ gridTemplateRows: isHeroScope ? "1fr" : "0fr" }}
        inert={!isHeroScope}
      >
        <div className="overflow-hidden">
          <section className="space-y-3 border-t border-[color:var(--aqt-border)] pt-5 pb-0.5">
            <Eyebrow as="h2" className="aqt-tnum">{t("users.compare.filters.heroAndMap")}</Eyebrow>
            <div className="grid gap-3 md:grid-cols-3">
              <FilterField label={t("users.compare.filters.primaryHero")}>
                <SearchableImageSelect
                  value={leftHeroId ? String(leftHeroId) : undefined}
                  onValueChange={(val) => {
                    const nextHeroId = val ? parseOptionalInt(val) : undefined;
                    updateParams({ left_hero_id: nextHeroId, right_hero_id: nextHeroId });
                  }}
                  options={heroOptions}
                  placeholder={t("users.compare.allHeroes")}
                  searchPlaceholder={t("users.compare.filters.searchHero")}
                  ariaLabel={t("users.compare.filters.primaryHero")}
                  isLoading={isHeroesLoading}
                  disabled={isHeroesLoading || isHeroesError}
                />
              </FilterField>

              <FilterField label={t("users.compare.filters.compareHero")}>
                <SearchableImageSelect
                  value={rightHeroId ? String(rightHeroId) : undefined}
                  onValueChange={(val) =>
                    updateParams({ right_hero_id: val ? parseOptionalInt(val) : undefined })
                  }
                  options={heroOptions}
                  placeholder={t("users.compare.allHeroes")}
                  searchPlaceholder={t("users.compare.filters.searchHero")}
                  ariaLabel={t("users.compare.filters.compareHero")}
                  isLoading={isHeroesLoading}
                  disabled={isHeroesLoading || isHeroesError}
                />
              </FilterField>

              <FilterField label={t("users.compare.filters.mapFilter")}>
                <SearchableImageSelect
                  value={mapId ? String(mapId) : undefined}
                  onValueChange={(val) =>
                    updateParams({ map_id: val ? parseOptionalInt(val) : undefined })
                  }
                  options={mapOptions}
                  placeholder={t("users.compare.filters.allMaps")}
                  searchPlaceholder={t("users.compare.filters.searchMap")}
                  ariaLabel={t("users.compare.filters.mapFilter")}
                  isLoading={isMapsLoading}
                  disabled={isMapsLoading || isMapsError}
                />
              </FilterField>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default CompareFiltersPanel;
