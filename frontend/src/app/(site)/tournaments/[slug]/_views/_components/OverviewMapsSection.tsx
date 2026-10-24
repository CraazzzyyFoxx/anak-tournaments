"use client";

import { useTranslations } from "next-intl";

import { Eyebrow } from "@/components/ui/eyebrow";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tournament } from "@/types/tournament.types";

import { MapCard } from "../../_components/MapCard";
import { useTournamentHasMapPool, useTournamentMapPool } from "../../_hooks/useTournamentMapPool";
import { OverviewSection, SectionLink } from "./OverviewCards";

const FLAT_POOL_PREVIEW = 6;

/**
 * Before the start: the maps the first round plays, in pictures — what a
 * player prepares for. Per round, never the merged pool, for the Maps
 * section's own reason (no single match plays from the union): a slot-mode
 * round shows its candidates per map of the series. Only a tournament-wide
 * config, which has no rounds to lay out, shows its pool, cut to one row.
 */
export function OverviewMapsSection({
  tournament,
  overviewHref
}: Readonly<{ tournament: Tournament; overviewHref: string }>) {
  // The rail's own gate (a cache read by now): no pool, no section, and no
  // catalogue read for one.
  const hasMapPool = useTournamentHasMapPool(tournament.id);
  return hasMapPool ? <FirstRoundMaps tournament={tournament} overviewHref={overviewHref} /> : null;
}

function FirstRoundMaps({
  tournament,
  overviewHref
}: Readonly<{ tournament: Tournament; overviewHref: string }>) {
  const t = useTranslations();
  const mapPool = useTournamentMapPool(tournament.id, tournament.discipline);

  // A teaser that failed to load says nothing worth a retry here: the Maps
  // section one tab away carries the error state.
  if (mapPool.isError) return null;

  const firstRound = mapPool.stages[0]?.rounds[0] ?? null;
  // A slot-mode round names a few candidates per map of the series; a pool
  // (a pool-mode round, or the tournament-wide config) can name twenty, so it
  // is cut to one row and the link carries the rest.
  const slots = firstRound?.slots ?? [
    {
      position: 0,
      maps: (firstRound?.pool ?? mapPool.pool).byGamemode
        .flatMap((group) => group.maps)
        .slice(0, FLAT_POOL_PREVIEW)
    }
  ];
  if (!mapPool.isPending && slots.every((slot) => slot.maps.length === 0)) return null;

  return (
    <OverviewSection
      title={t(
        firstRound?.round
          ? "tournamentDetail.overview.maps.firstRound"
          : "tournamentDetail.overview.maps.pool"
      )}
      action={
        <SectionLink href={`${overviewHref}/maps`}>
          {t("tournamentDetail.overview.maps.all", { count: mapPool.pool.total })}
        </SectionLink>
      }
    >
      {mapPool.isPending ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-hidden>
          {Array.from({ length: FLAT_POOL_PREVIEW }, (_, index) => (
            <Skeleton key={index} className="aspect-[2/1] w-full" />
          ))}
        </div>
      ) : (
        <>
          {firstRound && mapPool.stages.length > 1 ? (
            <p className="-mt-1.5 mb-3 text-caption text-[color:var(--aqt-fg-faint)]">
              {firstRound.title}
            </p>
          ) : null}
          <div className={slots.length > 1 ? "grid gap-x-6 gap-y-4 lg:grid-cols-2" : undefined}>
            {slots.map((slot) => (
              <div key={slot.position} className="min-w-0">
                {slot.position > 0 ? (
                  <Eyebrow as="div" className="mb-2">
                    {t("tournamentDetail.mapPool.slot", { n: slot.position })}
                  </Eyebrow>
                ) : null}
                {/* Under 640px a slot stays one line and scrolls, the next map
                    half in view; from 640px the candidates share the row. */}
                <div
                  className={
                    slots.length > 1
                      ? "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0"
                      : "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6"
                  }
                >
                  {slot.maps.map((map) => (
                    <MapCard
                      key={map.id}
                      map={map}
                      size="sm"
                      className="w-[9rem] shrink-0 snap-start sm:w-auto"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </OverviewSection>
  );
}
