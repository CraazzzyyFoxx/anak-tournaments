"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import mapService from "@/services/map.service";
import tournamentService from "@/services/tournament.service";
import type { MapRead } from "@/types/map.types";
import type { MapVetoConfig, Stage } from "@/types/tournament.types";

import styles from "../TournamentDetail.module.css";
import { TournamentPageState } from "../_components/TournamentPageState";
import { TournamentMapsSkeleton } from "../_components/TournamentSkeletons";
import { UpdatingBadge } from "../_components/UpdatingBadge";
import { getPublicPageQueryPresentation } from "./publicPageQueryPresentation";

interface TournamentMapsPageProps {
  tournamentId: number;
}

/**
 * Candidates a slot needs to be bannable down to one map. Mirrors the server's
 * `SLOT_CANDIDATE_FLOOR`, which refuses fewer at upsert and re-checks at session
 * creation, because a slot's candidate rows carry `map_id` FKs that cascade from
 * `overwatch.map`: deleting a map can drop a stored slot under the floor with no
 * upsert running.
 */
const SLOT_CANDIDATE_FLOOR = 2;

/** One map a config names, resolved against the catalogue when it can be. */
interface PoolEntry {
  id: number;
  /** Null when the competitive catalogue carries no map with this id. */
  map: MapRead | null;
}

/** One map of a series: a slot with its candidates, or a flat config's pool. */
interface LevelRow {
  /** The slot's own `position`, or null for a flat config's single pool. */
  position: number | null;
  candidates: PoolEntry[];
  /** The map the regulation plays on a draw, or null when none is named. */
  reserve: PoolEntry | null;
}

interface LevelView {
  key: string;
  /** Signed round, or null for a whole-stage / tournament-wide level. */
  round: number | null;
  /** "Round 1", "Lower R2", or the whole-stage / tournament-wide level's name. */
  label: string;
  /** Which half of the bracket the level sits in; drives the optional heading. */
  half: "upper" | "lower" | "none";
  rows: LevelRow[];
}

interface StageView {
  key: string;
  /** Null for the tournament-wide level, which belongs to no stage. */
  title: string | null;
  levels: LevelView[];
}

/**
 * Every map id the tournament's veto configs name, anywhere.
 *
 * Not rendered as a list of its own any more — a flat run of every map the
 * tournament owns answered a question nobody asked twice, once at the top of the
 * page and again as the tournament-default level below it. It survives as the
 * page's emptiness signal: no config naming a single resolvable map means there
 * is no pool to show.
 */
function collectPoolIds(configs: MapVetoConfig[]): Set<number> {
  const ids = new Set<number>();
  for (const config of configs) {
    for (const id of config.map_ids) ids.add(id);
    for (const slot of config.slots) {
      for (const id of slot.candidates) ids.add(id);
      if (slot.reserve_map_id != null) ids.add(slot.reserve_map_id);
    }
  }
  return ids;
}

/**
 * Every configured level, grouped by stage and ordered the way it is played.
 *
 * A flat enumeration of what the organizer wrote, with no inheritance reasoning:
 * a level appears here when it carries a config of its own, and a round that
 * inherits simply has no entry. Resolving the cascade instead would put the same
 * pool under a dozen headings.
 *
 * Round order is play order, not numeric order: upper rounds ascend, then lower
 * rounds by depth, so `-1` reads before `-2`.
 */
function buildStageViews(
  configs: MapVetoConfig[],
  stagesById: Map<number, Stage>,
  mapsById: Map<number, MapRead>,
  label: {
    tournament: string;
    wholeStage: string;
    round: (round: number) => string;
    unknownStage: (id: number) => string;
  }
): StageView[] {
  const entry = (id: number): PoolEntry => ({ id, map: mapsById.get(id) ?? null });
  const rowsOf = (config: MapVetoConfig): LevelRow[] => {
    if (config.mode !== "slots") {
      // One pool for every map of the series, so one row and no slot number.
      return [{ position: null, candidates: config.map_ids.map(entry), reserve: null }];
    }
    // Sorted on `position` rather than trusted from the wire, the same way the
    // admin editor and the veto room sort them: `position` is the play order and
    // nothing else here reconstructs it.
    return [...config.slots]
      .sort((left, right) => left.position - right.position)
      .map((slot) => ({
        position: slot.position,
        candidates: slot.candidates.map(entry),
        reserve: slot.reserve_map_id != null ? entry(slot.reserve_map_id) : null
      }));
  };

  const byStage = new Map<number | null, MapVetoConfig[]>();
  for (const config of configs) {
    const stageId = config.stage_id ?? null;
    const bucket = byStage.get(stageId);
    if (bucket) bucket.push(config);
    else byStage.set(stageId, [config]);
  }

  const views: StageView[] = [];
  for (const [stageId, stageConfigs] of byStage) {
    const levels: LevelView[] = stageConfigs.map((config) => {
      const round = config.round ?? null;
      const wholeScopeLabel = stageId == null ? label.tournament : label.wholeStage;
      return {
        key: `${stageId ?? "tournament"}:${round ?? "whole"}`,
        round,
        label: round == null ? wholeScopeLabel : label.round(round),
        half: round == null ? "none" : round > 0 ? "upper" : "lower",
        rows: rowsOf(config)
      };
    });
    // The stage-wide level first, then the upper bracket in order, then the
    // lower bracket by depth.
    const rank = (level: LevelView) => (level.round == null ? 0 : level.round > 0 ? 1 : 2);
    levels.sort(
      (left, right) =>
        rank(left) - rank(right) || Math.abs(left.round ?? 0) - Math.abs(right.round ?? 0)
    );

    views.push({
      key: String(stageId ?? "tournament"),
      title:
        stageId == null ? null : (stagesById.get(stageId)?.name ?? label.unknownStage(stageId)),
      levels
    });
  }

  // The tournament-wide level first — it is the one that applies everywhere —
  // then stages in the order they are played. A stage the stages read does not
  // carry sorts last rather than pretending to an order it has no field for.
  const stageOrder = (view: StageView) =>
    view.title === null ? -1 : (stagesById.get(Number(view.key))?.order ?? Number.MAX_SAFE_INTEGER);
  return views.sort(
    (left, right) => stageOrder(left) - stageOrder(right) || left.key.localeCompare(right.key)
  );
}

/**
 * Drop the levels that are not rounds, as long as a round exists somewhere.
 *
 * A stage- or tournament-wide level is the fallback for rounds that carry no
 * config of their own. Shown alongside real rounds it reads as one more round
 * with thirty maps in it — the duplicate aggregate list this page was built to
 * stop showing. When nothing else is configured it is the only answer there is,
 * so it stays.
 */
function keepPlayableLevels(views: StageView[]): StageView[] {
  const hasRound = views.some((view) => view.levels.some((level) => level.round != null));
  if (!hasRound) return views;
  return views
    .map((view) => ({ ...view, levels: view.levels.filter((level) => level.round != null) }))
    .filter((view) => view.levels.length > 0);
}

/**
 * The game mode every candidate of a slot shares, or null when they differ.
 *
 * Regulations pick one mode per map of the series — "map 1 is an escort map, one
 * of these three" — so naming it turns a row of three pictures into a rule the
 * reader can hold. Unanimity is the whole point: a mixed slot has no such rule
 * and says nothing rather than picking one arbitrarily.
 */
function sharedGamemode(candidates: PoolEntry[]): string | null {
  const names = new Set<string>();
  for (const candidate of candidates) {
    const name = candidate.map?.gamemode?.name;
    if (!name) return null;
    names.add(name);
  }
  return names.size === 1 ? [...names][0] : null;
}

/**
 * One candidate, as its map art.
 *
 * The picture is the point, so the art gets the tile and the scrim only covers
 * the bottom half it has to: under a scrim three quarters deep, Havana and Dorado
 * were two brown smudges.
 *
 * `next/image` rather than a CSS background: it lazy-loads, so a page holding a
 * hundred map photographs fetches the handful on screen instead of all of them.
 * `alt=""` because the name is rendered over it — the picture decorates a label
 * that already says what it is.
 *
 * A component of its own because art can 404: the catalogue holds paths for maps
 * whose file was never uploaded, and two of them sit in this tournament's pool.
 * The failure falls back to the same flat wash a map with no path at all gets,
 * rather than leaving the browser's broken-image glyph on a public page.
 *
 * The hairline is pure white at 10%, not `--aqt-border`: a tinted neutral outline
 * picks up the map art underneath it and reads as dirt along the edge.
 */
function CandidateTile({ art, name }: { art: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <li className="relative flex h-[5.25rem] min-w-0 flex-1 basis-[calc(50%-0.25rem)] items-end overflow-hidden rounded-lg bg-[color:var(--aqt-overlay-2)] ring-1 ring-inset ring-[hsl(0_0%_100%/0.1)] sm:h-24 sm:w-44 sm:flex-none sm:basis-auto">
      {art && !failed ? (
        <Image
          src={art}
          alt=""
          fill
          sizes="(min-width: 640px) 176px, 50vw"
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
      {/* Explicit scrim rather than trusting image luminance: map art ranges from
          Antarctic white to Havana night and the label must read on both. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/55 to-transparent"
      />
      <span className="relative z-10 line-clamp-2 px-2.5 pb-2 text-[13px] font-semibold leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
        {name}
      </span>
    </li>
  );
}

export default function TournamentMapsPage({ tournamentId }: TournamentMapsPageProps) {
  const t = useTranslations();
  const searchParams = useSearchParams();

  // No `.catch(() => ({ configs: [] }))` here: swallowing the failure would make
  // a 422/500/offline read indistinguishable from "the organizer configured
  // nothing", which is the same fabrication this page exists to stop telling.
  // A failed read renders the error state below; an empty *successful* read is
  // the only thing allowed to render "not configured".
  const vetoConfigsQuery = useQuery({
    queryKey: ["public", "tournament", tournamentId, "veto-configs"],
    queryFn: () => tournamentService.getVetoConfigs(tournamentId)
  });

  // `entities: ["gamemode"]` is load-bearing twice over: the maps endpoint only
  // serialises the gamemode relation when asked, and without it no slot can name
  // the mode its candidates share. The query key carries the same marker so this
  // never shares a cache entry with a gamemode-less fetch.
  const mapsQuery = useQuery({
    queryKey: ["maps", "all", "gamemode"],
    queryFn: () =>
      mapService.getAll({ perPage: -1, sort: "name", order: "asc", entities: ["gamemode"] })
  });

  // Stages are read for their names and their order only, so this one degrades
  // rather than blocking: a stage the read does not carry is named by its id and
  // sorts last. Deliberately not swallowed, so the failure still reaches the
  // global error handler.
  const stagesQuery = useQuery({
    queryKey: ["public", "tournament", tournamentId, "stages"],
    queryFn: () => tournamentService.getStages(tournamentId)
  });

  const maps = useMemo(() => {
    const raw = mapsQuery.data?.results ?? [];
    return raw.filter((map) => map.in_competitive !== false);
  }, [mapsQuery.data]);
  const configs = useMemo(() => vetoConfigsQuery.data?.configs ?? [], [vetoConfigsQuery.data]);
  const stagesById = useMemo(
    () => new Map((stagesQuery.data ?? []).map((stage) => [stage.id, stage])),
    [stagesQuery.data]
  );
  const mapsById = useMemo(() => new Map(maps.map((map) => [map.id, map])), [maps]);

  /** Every map any level names, resolved: the page's "is there a pool" answer. */
  const poolSize = useMemo(() => {
    const ids = collectPoolIds(configs);
    return maps.filter((map) => ids.has(map.id)).length;
  }, [configs, maps]);

  const stageViews = useMemo(
    () =>
      keepPlayableLevels(
        buildStageViews(configs, stagesById, mapsById, {
          tournament: t("mapVeto.scope.tournamentDefault"),
          wholeStage: t("mapVeto.wholeStage"),
          round: (round) =>
            round < 0
              ? // The same label the bracket view gives this round, so the two
                // surfaces name it identically.
                t("bracket.lowerRound", { n: String(-round) })
              : t("bracket.round", { n: String(round) }),
          unknownStage: (id) => t("mapVeto.scope.unknownStage", { id })
        })
      ),
    [configs, stagesById, mapsById, t]
  );

  /**
   * The stage on screen, from `?stage=` the way the bracket reads it, so a link
   * to one stage's pools survives being pasted. A parameter naming a stage this
   * tournament does not configure falls back to the first one it plays rather
   * than to an empty page, and `useSearchParams` is optional-chained because it
   * yields null wherever this renders without a router around it.
   */
  const activeStage =
    stageViews.find((view) => view.key === searchParams?.get("stage")) ?? stageViews[0] ?? null;

  /**
   * The same loading / empty / updating / refresh-error vocabulary every other
   * public tournament page speaks.
   *
   * `data` is withheld until BOTH load-bearing reads land: without the configs
   * there is no pool, and without the catalogue no id can be named or pictured,
   * so either one missing means the page cannot say anything true yet. Once they
   * have landed, a failing refetch keeps the rendered rounds on screen under a
   * refresh-error banner rather than replacing them with a full-page error.
   *
   * The stages read is deliberately absent: it only supplies stage names, and a
   * stage it does not carry is named by its id.
   */
  const presentation = getPublicPageQueryPresentation({
    data: vetoConfigsQuery.data && mapsQuery.data ? vetoConfigsQuery.data : undefined,
    itemCount: poolSize,
    isPending: vetoConfigsQuery.isPending || mapsQuery.isPending,
    isError: vetoConfigsQuery.isError || mapsQuery.isError,
    isFetching: vetoConfigsQuery.isFetching || mapsQuery.isFetching
  });

  const retry = () => {
    if (vetoConfigsQuery.isError) void vetoConfigsQuery.refetch();
    if (mapsQuery.isError) void mapsQuery.refetch();
  };

  if (presentation.initialState === "error") {
    return <TournamentPageState state="initial-error" onRetry={retry} />;
  }

  if (presentation.initialState === "skeleton" || presentation.contentState === null) {
    return <TournamentMapsSkeleton />;
  }

  /**
   * An id the catalogue cannot resolve keeps its tile and its name: a slot's
   * candidate count is what the regulation is written against, so dropping the
   * tile would report a three-way ban as a two-way one.
   */
  const renderCandidate = (entry: PoolEntry, index: number) => (
    <CandidateTile
      // The same map legitimately appears in more than one slot and even twice in
      // one, so the key carries the position it is listed at.
      key={`${entry.id}-${index}`}
      art={entry.map?.image_path ?? null}
      name={entry.map?.name ?? t("encounters.veto.room.maps.mapNumber", { id: entry.id })}
    />
  );

  const renderRow = (row: LevelRow, index: number) => {
    const mode = sharedGamemode(row.candidates);
    const modeIcon = row.candidates.find((candidate) => candidate.map?.gamemode?.name === mode)?.map
      ?.gamemode?.image_path;
    const reserveName =
      row.reserve?.map?.name ??
      (row.reserve ? t("encounters.veto.room.maps.mapNumber", { id: row.reserve.id }) : null);
    return (
      // Label beside the maps on wide screens, above them when there is no room:
      // one line per map of the series reads the way the regulation writes it,
      // and thirty-three stacked label-then-pictures blocks did not.
      <div
        key={row.position ?? index}
        className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3.5"
      >
        <p className="flex items-center gap-2 sm:w-40 sm:shrink-0 sm:pt-1">
          {row.position != null ? (
            // The numeral, not the word: a column of 1 / 2 / 3 down the left edge
            // is the rhythm that tells a reader where one map of the series ends
            // and the next begins. Mono and tabular so the digits line up.
            <span
              data-slot-index
              aria-label={t("encounters.veto.room.slot.label", { n: row.position })}
              // `tabular-nums` rather than the site's `.aqt-mono`: that class
              // reads `var(--aqt-mono)`, which is declared on `:root` while the
              // font variable it points at is declared on `<body>`, so it
              // resolves to nothing and silently renders Inter.
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[color:color-mix(in_srgb,var(--aqt-teal)_14%,transparent)] text-[11px] font-bold tabular-nums text-[color:var(--aqt-teal)]"
            >
              {row.position}
            </span>
          ) : (
            <span
              data-slot-index
              className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--aqt-fg-muted)]"
            >
              {t("mapVeto.roundPoolShared")}
            </span>
          )}
          {/* The rule behind the row: one mode per map of the series. */}
          {mode ? (
            <span data-slot-mode className="flex min-w-0 items-center gap-1.5">
              {modeIcon ? (
                <Image src={modeIcon} alt="" width={14} height={14} className="opacity-70" />
              ) : null}
              <span className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--aqt-fg-muted)]">
                {mode}
              </span>
            </span>
          ) : null}
        </p>
        <div className="min-w-0 flex-1 space-y-1.5">
          {row.position != null && row.candidates.length < SLOT_CANDIDATE_FLOOR ? (
            <p className="text-xs text-destructive">
              {t("mapVeto.slotUnderfilled", { n: row.position })}
            </p>
          ) : null}
          <ul className="flex flex-wrap gap-2">{row.candidates.map(renderCandidate)}</ul>
          {reserveName ? (
            <p className="text-xs text-[color:var(--aqt-fg-muted)]">
              {t("encounters.veto.room.slot.reserve", { map: reserveName })}
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  const renderLevel = (level: LevelView) => (
    // No box of its own: nested inside the stage card it was a third grey
    // rectangle competing with the two around it. A divider and a heading carry
    // the same separation and leave the map art as the only colour on the page.
    <div key={level.key} className="px-4 py-3.5">
      <h3 className="text-sm font-semibold tracking-tight">{level.label}</h3>
      {/* Ordered, because the order is the answer: a slot's number is the map of
          the series it decides, and a series only reaches the later ones. */}
      <ol className="mt-2.5 space-y-3">
        {level.rows.map((row, index) => (
          <li key={row.position ?? index}>{renderRow(row, index)}</li>
        ))}
      </ol>
    </div>
  );

  const renderStageView = (view: StageView) => {
    const hasLower = view.levels.some((level) => level.half === "lower");
    const halves = [
      { half: "none" as const, heading: null },
      // Headings only where they discriminate: a stage with one bracket would be
      // announced "Upper bracket" for a distinction it does not have.
      { half: "upper" as const, heading: hasLower ? t("mapVeto.roundGroupUpper") : null },
      { half: "lower" as const, heading: hasLower ? t("mapVeto.roundGroupLower") : null }
    ];
    const title = view.title ?? t("mapVeto.scope.tournamentDefault");
    return (
      // One surface per stage rather than one for the whole page: a stage is the
      // unit a reader looks up, and twelve rounds of map art in a single card is
      // a wall to scroll past instead of a place to land.
      <section
        key={view.key}
        className="tn-card overflow-hidden"
        role="group"
        aria-label={title}
      >
        <header className="border-b border-[color:var(--aqt-border)] px-4 py-3">
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
        </header>
        <div className="divide-y divide-[color:var(--aqt-border)]">
          {halves.flatMap(({ half, heading }) => {
            const levels = view.levels.filter((level) => level.half === half);
            if (levels.length === 0) return [];
            return [
              // A full-bleed band rather than a line of small text: the same
              // sectioning label the rest of the tournament chrome uses, so the
              // two halves of a bracket separate at a glance.
              heading ? (
                <p
                  key={`${half}-heading`}
                  className="bg-[color:var(--aqt-overlay-1)] px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--aqt-fg-faint)]"
                >
                  {heading}
                </p>
              ) : null,
              ...levels.map(renderLevel)
            ];
          })}
        </div>
      </section>
    );
  };

  const content = (
    // The container every public tournament page uses: it pins its own children
    // to `min-width: 0`, so an intrinsically wide descendant owns its overflow
    // locally instead of taking the document's horizontal scrollbar with it.
    <section className={styles.publicDataPage} aria-label={t("common.maps")}>
      {presentation.showUpdating ? <UpdatingBadge /> : null}

      {presentation.contentState === "empty" || stageViews.length === 0 || !activeStage ? (
        <TournamentPageState
          state="empty"
          title={t("mapVeto.notConfiguredTitle")}
          description={t("mapVeto.notConfiguredDescription")}
        />
      ) : (
        <>
          {/* The bracket's own stage switcher, on the bracket's own classes, so
              the two surfaces change stage the same way and a link to one round's
              pool survives being pasted. A single stage needs no switch. */}
          {stageViews.length > 1 ? (
            <div className={styles.controlRail}>
              <div className="stage-tabs" role="group" aria-label={t("common.stages")}>
                {stageViews.map((view) => {
                  const isActive = view.key === activeStage.key;
                  return (
                    <Link
                      key={view.key}
                      href={`/tournaments/${tournamentId}/maps?stage=${view.key}`}
                      aria-current={isActive ? "page" : undefined}
                      className={cn("stage-tab", isActive && "active")}
                    >
                      {view.title ?? t("mapVeto.scope.tournamentDefault")}
                      <span className="count">{view.levels.length}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
          {renderStageView(activeStage)}
        </>
      )}
    </section>
  );

  if (presentation.showRefreshError) {
    return (
      <TournamentPageState
        state="refresh-error"
        onRetry={retry}
        isUpdating={vetoConfigsQuery.isFetching || mapsQuery.isFetching}
      >
        {content}
      </TournamentPageState>
    );
  }

  return content;
}
