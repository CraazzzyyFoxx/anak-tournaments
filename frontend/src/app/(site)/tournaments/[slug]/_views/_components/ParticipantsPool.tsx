"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { HeroStrip } from "@/components/hero/HeroImage";
import { resolveDivisionFromRank } from "@/lib/division-grid";
import { isRoleSlotCode, orderSlotCodes, ROSTER_SLOT_CODES } from "@/lib/roster-shape";
import type { RosterShape } from "@/lib/roster-shape";
import { cn } from "@/lib/utils";
import type { Hero } from "@/types/hero.types";
import type { Registration, RegistrationRole } from "@/types/registration.types";
import type { DivisionGrid } from "@/types/workspace.types";
import { getPlayerSlug } from "@/utils/player";

import { getRoleLabel } from "./participantsColumns";
import { TournamentPageState } from "../../_components/TournamentPageState";

/** The one status that means "was in, took themselves out" (§6 ④). */
const WITHDRAWN_STATUS = "withdrawn";

/**
 * How many players a role column shows before the rest move into a `<details>`.
 * A pool column can hold thirty names; the question the column answers ("how
 * deep is this role, who is at the top") is answered by the first screenful.
 */
const VISIBLE_PER_COLUMN = 10;

/** Icon names `PlayerRoleIcon` knows, keyed by the registration role code. */
const ROLE_TO_ICON: Record<string, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
  flex: "Flex"
};

const ROLE_ACCENT: Record<string, string> = {
  tank: "text-[color:var(--aqt-tank)]",
  dps: "text-[color:var(--aqt-damage)]",
  support: "text-[color:var(--aqt-support)]"
};

interface PoolEntry {
  registration: Registration;
  role: RegistrationRole;
  division: number | null;
  /** The player declared more than one role, so they sit in several columns. */
  isFlex: boolean;
}

export interface ParticipantsPoolProps {
  /** Every registration of the tournament, withdrawn ones included. */
  registrations: readonly Registration[];
  /** Drives which role columns exist; `null` falls back to the declared roles. */
  rosterShape: RosterShape | null;
  divisionGrid: DivisionGrid;
  heroesMap: Map<string, Hero>;
  search: string;
  division: number | null;
  /** Clears search + division for the filtered-empty state. */
  onResetFilters: () => void;
}

function isWithdrawn(registration: Registration): boolean {
  return registration.status === WITHDRAWN_STATUS;
}

/**
 * Divisions actually represented in the pool, ascending. Offering the whole
 * ladder would hand the reader twenty options of which three match anybody.
 */
export function poolDivisionOptions(
  registrations: readonly Registration[],
  grid: DivisionGrid
): number[] {
  const present = new Set<number>();
  for (const registration of registrations) {
    if (isWithdrawn(registration)) continue;
    for (const role of registration.roles ?? []) {
      const division = resolveDivisionFromRank(grid, role.rank_value);
      if (division != null) present.add(division);
    }
  }
  return [...present].sort((left, right) => left - right);
}

/** Heroes for one role, resolved through the catalogue with a slug fallback. */
function topHeroes(role: RegistrationRole, heroesMap: Map<string, Hero>, limit: number): Hero[] {
  const heroes: Hero[] = [];
  for (const slug of role.top_heroes ?? []) {
    if (!slug || heroes.length >= limit) continue;
    const hero = heroesMap.get(slug);
    heroes.push(hero ?? ({ name: slug, slug, image_path: "", role: role.role } as Hero));
  }
  return heroes;
}

function PoolRow({
  entry,
  heroesMap,
  showRank
}: Readonly<{ entry: PoolEntry; heroesMap: Map<string, Hero>; showRank: boolean }>) {
  const t = useTranslations();
  const { registration, role, division, isFlex } = entry;
  const rank = role.rank_value ?? null;
  const heroes = topHeroes(role, heroesMap, 3);
  const battleTag = registration.battle_tag ?? "\u2014";
  // A multi-role player is listed in every role column; in the columns of their
  // secondary roles the name is dimmed. That says "also plays this" without a
  // glyph — in a flex tournament nearly every row would carry the glyph and it
  // would say nothing.
  const secondary = isFlex && !role.is_primary;
  const flexTitle = isFlex
    ? t("tournamentDetail.participantsPool.flexTitle", {
        roles: (registration.roles ?? [])
          .map((declared) => getRoleLabel(declared.role, t))
          .join(" · ")
      })
    : null;

  return (
    <li className="flex items-center gap-2 py-1" data-flex-mark={isFlex || undefined}>
      <span className="flex min-w-0 flex-1 items-center gap-1">
        {registration.battle_tag ? (
          <a
            href={`/users/${getPlayerSlug(registration.battle_tag)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "truncate transition hover:text-[color:var(--aqt-teal)] hover:underline",
              secondary
                ? "text-[color:var(--aqt-fg-muted)]"
                : "font-medium text-[color:var(--aqt-fg)]"
            )}
            title={flexTitle ?? battleTag}
          >
            {battleTag}
          </a>
        ) : (
          <span className="truncate text-[color:var(--aqt-fg-dim)]">{battleTag}</span>
        )}
        {flexTitle ? <span className="sr-only">{flexTitle}</span> : null}
      </span>
      {showRank ? (
        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-[color:var(--aqt-fg-muted)]">
          {division != null && rank != null
            ? t("tournamentDetail.participantsPool.rank", { division, rank })
            : "\u2014"}
        </span>
      ) : null}
      {heroes.length > 0 ? (
        <HeroStrip heroes={heroes} size="sm" limit={3} className="shrink-0" />
      ) : null}
    </li>
  );
}

function RoleColumn({
  role,
  entries,
  heroesMap,
  showRank
}: Readonly<{
  role: string;
  entries: PoolEntry[];
  heroesMap: Map<string, Hero>;
  showRank: boolean;
}>) {
  const t = useTranslations();
  const visible = entries.slice(0, VISIBLE_PER_COLUMN);
  const rest = entries.slice(VISIBLE_PER_COLUMN);

  return (
    <section
      className="rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] p-3"
      aria-label={t("tournamentDetail.participantsPool.columnLabel", {
        role: getRoleLabel(role, t),
        count: entries.length
      })}
      data-pool-column={role}
    >
      <h3 className="mb-2 flex items-center gap-2 border-b border-[color:var(--aqt-border)] pb-2">
        <span className={cn("inline-flex shrink-0", ROLE_ACCENT[role])}>
          <PlayerRoleIcon role={ROLE_TO_ICON[role] ?? role} size={16} decorative />
        </span>
        <span className="aqt-mono text-[11px] uppercase tracking-[.06em] text-[color:var(--aqt-fg)]">
          {getRoleLabel(role, t)}
        </span>
        <span className="ml-auto text-xs tabular-nums text-[color:var(--aqt-fg-dim)]">
          {entries.length}
        </span>
      </h3>
      {entries.length === 0 ? (
        <p className="py-1 text-xs text-[color:var(--aqt-fg-dim)]">
          {t("tournamentDetail.participantsPool.columnEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--aqt-border)]">
          {visible.map((entry) => (
            <PoolRow
              key={entry.registration.id}
              entry={entry}
              heroesMap={heroesMap}
              showRank={showRank}
            />
          ))}
        </ul>
      )}
      {rest.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer list-none py-1 text-xs text-[color:var(--aqt-fg-muted)] transition hover:text-[color:var(--aqt-fg)]">
            {t("tournamentDetail.participantsPool.more", { count: rest.length })}
          </summary>
          <ul className="divide-y divide-[color:var(--aqt-border)]">
            {rest.map((entry) => (
              <PoolRow
                key={entry.registration.id}
                entry={entry}
                heroesMap={heroesMap}
                showRank={showRank}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * The player pool of a balancer/draft tournament (§6 ②③④): one column per role
 * slot the roster shape asks for, each sorted by rank, a player who declared
 * several roles listed in every one of them, and the withdrawn registrations
 * folded away at the bottom instead of eating a filter chip.
 */
export default function ParticipantsPool({
  registrations,
  rosterShape,
  divisionGrid,
  heroesMap,
  search,
  division,
  onResetFilters
}: Readonly<ParticipantsPoolProps>) {
  const t = useTranslations();

  const active = useMemo(
    () => registrations.filter((registration) => !isWithdrawn(registration)),
    [registrations]
  );

  // Columns come from the roster shape's role slots, never a hardcoded trio.
  // `flex` is dropped: it is a wildcard slot, not a role anybody registers as,
  // so a FLEX column would be permanently empty. Any role a player declared
  // that the shape does not list is appended, so nobody becomes invisible.
  const roleColumns = useMemo(() => {
    const fromShape = rosterShape ? orderSlotCodes(rosterShape.slots).filter(isRoleSlotCode) : [];
    const declared = new Set<string>();
    for (const registration of active) {
      for (const role of registration.roles ?? []) {
        if (role.role) declared.add(role.role);
      }
    }
    const extra = [...declared]
      .filter((role) => !fromShape.includes(role as (typeof fromShape)[number]) && role !== "flex")
      .sort((left, right) => {
        // Unknown codes sort after every canonical one, then alphabetically.
        const leftIndex = ROSTER_SLOT_CODES.indexOf(left as (typeof ROSTER_SLOT_CODES)[number]);
        const rightIndex = ROSTER_SLOT_CODES.indexOf(right as (typeof ROSTER_SLOT_CODES)[number]);
        const leftRank = leftIndex === -1 ? ROSTER_SLOT_CODES.length : leftIndex;
        const rightRank = rightIndex === -1 ? ROSTER_SLOT_CODES.length : rightIndex;
        return leftRank - rightRank || left.localeCompare(right);
      });
    return [...fromShape, ...extra] as string[];
  }, [active, rosterShape]);

  const normalizedSearch = search.trim().toLowerCase();

  const entriesByRole = useMemo(() => {
    const grouped = new Map<string, PoolEntry[]>();
    for (const role of roleColumns) grouped.set(role, []);

    for (const registration of active) {
      if (
        normalizedSearch.length > 0 &&
        !(registration.battle_tag?.toLowerCase().includes(normalizedSearch) ?? false)
      ) {
        continue;
      }
      const roles = registration.roles ?? [];
      const isFlex = roles.length > 1;
      for (const role of roles) {
        const bucket = grouped.get(role.role);
        if (!bucket) continue;
        const entryDivision = resolveDivisionFromRank(divisionGrid, role.rank_value);
        if (division != null && entryDivision !== division) continue;
        bucket.push({ registration, role, division: entryDivision, isFlex });
      }
    }

    for (const bucket of grouped.values()) {
      bucket.sort((left, right) => {
        const leftRank = left.role.rank_value ?? -1;
        const rightRank = right.role.rank_value ?? -1;
        if (leftRank !== rightRank) return rightRank - leftRank;
        // Players who main this role before those who only also play it.
        if (left.role.is_primary !== right.role.is_primary) return left.role.is_primary ? -1 : 1;
        return (left.registration.battle_tag ?? "").localeCompare(
          right.registration.battle_tag ?? ""
        );
      });
    }
    return grouped;
  }, [active, division, divisionGrid, normalizedSearch, roleColumns]);

  const withdrawn = useMemo(
    () =>
      registrations.filter(
        (registration) =>
          isWithdrawn(registration) &&
          (normalizedSearch.length === 0 ||
            (registration.battle_tag?.toLowerCase().includes(normalizedSearch) ?? false))
      ),
    [normalizedSearch, registrations]
  );

  const shownPlayers = useMemo(() => {
    const ids = new Set<number>();
    for (const bucket of entriesByRole.values()) {
      for (const entry of bucket) ids.add(entry.registration.id);
    }
    return ids.size;
  }, [entriesByRole]);

  // Before the organizer assigns ranks (the balancer does, after registration
  // closes) no entry has one, and a column of em dashes is noise.
  const showRank = useMemo(() => {
    for (const bucket of entriesByRole.values()) {
      if (bucket.some((entry) => entry.division != null && entry.role.rank_value != null))
        return true;
    }
    return false;
  }, [entriesByRole]);

  if (shownPlayers === 0 && withdrawn.length === 0) {
    const isFiltered = normalizedSearch.length > 0 || division != null;
    return isFiltered ? (
      <TournamentPageState state="filtered-empty" onReset={onResetFilters} />
    ) : (
      <TournamentPageState
        state="empty"
        title={t("tournamentDetail.participants.empty.title")}
        description={t("tournamentDetail.participants.empty.description")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {t("tournamentDetail.participantsPool.resultCount", { count: shownPlayers })}
      </p>

      {roleColumns.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roleColumns.map((role) => (
            <RoleColumn
              key={role}
              role={role}
              entries={entriesByRole.get(role) ?? []}
              heroesMap={heroesMap}
              showRank={showRank}
            />
          ))}
        </div>
      ) : null}

      {withdrawn.length > 0 ? (
        <details className="rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)] px-3 py-2">
          <summary className="cursor-pointer list-none text-xs text-[color:var(--aqt-fg-muted)] transition hover:text-[color:var(--aqt-fg)]">
            {t("tournamentDetail.participantsPool.withdrawn", { count: withdrawn.length })}
          </summary>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {withdrawn.map((registration) => (
              <li
                key={registration.id}
                className="text-xs text-[color:var(--aqt-fg-dim)] line-through"
              >
                {registration.battle_tag ?? "\u2014"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
