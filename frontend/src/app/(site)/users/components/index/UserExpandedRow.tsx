"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { roleOf } from "@/lib/roster/role-ref";

import { HoverPrefetchLink } from "@/components/HoverPrefetchLink";
import CatalogEntityImage from "@/components/catalog/CatalogEntityImage";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { PlaceBadge } from "@/components/ui/place-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { winrateColor } from "@/lib/colors";
import { getPlayerSlug } from "@/lib/player";
import { PLAYER_ROLE_LABEL_KEY, normalizePlayerRole } from "@/lib/roster/player-role";
import { formatOptional } from "@/app/(site)/users/components/shared/list-utils";
import userService from "@/services/user.service";
import { userQueryKeys } from "@/lib/users/query-keys";
import type { UserDraftCard } from "@/types/user.types";

import type { PlayerIdentity } from "./users-index.atoms";

const Label = ({ children }: Readonly<{ children: ReactNode }>) => (
  <span className="text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
    {children}
  </span>
);

const sharePct = (won: number, total: number): number | null =>
  total > 0 ? (won / total) * 100 : null;

function Winrate({ won, total }: Readonly<{ won: number; total: number }>) {
  const pct = sharePct(won, total);
  if (pct === null) return <span className="text-[color:var(--aqt-fg-faint)]">-</span>;
  return (
    <span className="font-semibold tabular-nums" style={{ color: winrateColor(pct) }}>
      {pct.toFixed(0)}%
    </span>
  );
}

/**
 * The per-player drawer. Its data is a separate read, fired only once the row
 * is actually open — the index ships ~100 rows a page and nobody opens 100.
 */
export function UserExpandedRow({
  user,
  workspaceId,
  discipline,
  compareSelected,
  compareDisabled,
  onToggleCompare
}: Readonly<{
  user: PlayerIdentity;
  workspaceId: number | "all" | null;
  /** The index's game: the drawer's career is that game's. */
  discipline: string;
  compareSelected: boolean;
  compareDisabled: boolean;
  onToggleCompare: () => void;
}>) {
  const t = useTranslations();
  const { data, isPending, isError } = useQuery({
    queryKey: userQueryKeys.draftCard(user.id, workspaceId, discipline),
    queryFn: () => userService.getDraftCard(user.id, discipline, workspaceId),
    staleTime: 60_000
  });

  if (isError) {
    return (
      <p className="px-4 py-5 text-caption text-[color:var(--aqt-rose)]">
        {t("users.list.errors.details")}
      </p>
    );
  }

  if (isPending || !data) {
    return (
      <div className="space-y-3 px-4 py-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`kpi-${index}`} className="h-12" />
          ))}
        </div>
        <Skeleton className="h-28" />
      </div>
    );
  }

  const slug = getPlayerSlug(user.name);

  return (
    <div className="space-y-5 px-4 py-5">
      <KpiGrid card={data} />

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="space-y-2">
          <Label>{t("users.list.expanded.roles")}</Label>
          {data.roles.length === 0 ? (
            <p className="text-caption text-[color:var(--aqt-fg-faint)]">
              {t("users.list.expanded.noRoleData")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.roles.map((role) => {
                const roleOption = (role.role ? normalizePlayerRole(roleOf(role.role)) : "Flex");
                return (
                <li key={`${role.role?.dimension}-${role.role?.role}`} className="flex items-center gap-2 text-caption">
                  <PlayerRoleIcon role={roleOption} size={16} decorative />
                  <span className="text-[color:var(--aqt-fg-muted)]">
                    {t(PLAYER_ROLE_LABEL_KEY[roleOption])}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <Winrate won={role.maps_won} total={role.maps} />
                    <span className="tabular-nums text-[color:var(--aqt-fg-faint)]">
                      {t("users.list.expanded.maps", { count: role.maps })}
                    </span>
                  </span>
                </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <Label>{t("users.list.expanded.recentTournaments")}</Label>
          {data.recent_tournaments.length === 0 ? (
            <p className="text-caption text-[color:var(--aqt-fg-faint)]">
              {t("users.list.expanded.noTournaments")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.recent_tournaments.map((tournament) => (
                <li key={tournament.id} className="flex items-center gap-2 text-caption">
                  {tournament.placement ? <PlaceBadge place={tournament.placement} /> : null}
                  <HoverPrefetchLink
                    href={`/tournaments/${tournament.id}`}
                    className="truncate text-[color:var(--aqt-fg-muted)] transition-colors hover:text-[color:var(--aqt-teal)]"
                  >
                    {tournament.name}
                  </HoverPrefetchLink>
                  {tournament.teams_count ? (
                    <span className="ml-auto shrink-0 tabular-nums text-[color:var(--aqt-fg-faint)]">
                      {t("users.list.expanded.outOf", { count: tournament.teams_count })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <Label>{t("users.list.expanded.heroes")}</Label>
          {!data.characters?.length ? (
            <p className="text-caption text-[color:var(--aqt-fg-faint)]">
              {t("users.list.expanded.noHeroData")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.characters.slice(0, 5).map((entry) => (
                <li key={entry.character.id} className="flex items-center gap-2 text-caption">
                  <CatalogEntityImage entity={entry.character} size="sm" decorative />
                  <span className="truncate text-[color:var(--aqt-fg-muted)]">{entry.character.name}</span>
                  <span className="ml-auto flex items-center gap-3">
                    <Winrate won={entry.maps_won} total={entry.maps} />
                    <span className="tabular-nums text-[color:var(--aqt-fg-faint)]">
                      {t("users.list.expanded.maps", { count: entry.maps })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <HoverPrefetchLink href={`/users/${slug}`} className="aqt-filter-chip no-underline">
          {t("users.list.expanded.openProfile")}
        </HoverPrefetchLink>
        <HoverPrefetchLink href={`/users/${slug}?tab=matches`} className="aqt-filter-chip no-underline">
          {t("common.matches")}
        </HoverPrefetchLink>
        <HoverPrefetchLink href={`/users/${slug}?tab=heroes`} className="aqt-filter-chip no-underline">
          {t("common.characters")}
        </HoverPrefetchLink>
        <button
          type="button"
          onClick={onToggleCompare}
          disabled={compareDisabled && !compareSelected}
          title={compareDisabled && !compareSelected ? t("users.list.compare.limit") : undefined}
          className="aqt-filter-chip disabled:cursor-not-allowed disabled:opacity-40"
          aria-pressed={compareSelected}
        >
          {compareSelected
            ? t("users.list.compare.removeShort")
            : t("users.list.compare.addShort")}
        </button>
      </div>
    </div>
  );
}

function KpiGrid({ card }: Readonly<{ card: UserDraftCard }>) {
  const t = useTranslations();
  const decided = card.maps_won + card.maps_lost;
  const winratePct = sharePct(card.maps_won, decided);

  const cells: Array<{ label: string; value: ReactNode }> = [
    { label: t("common.tournaments"), value: card.tournaments },
    { label: t("users.list.expanded.tournamentsWon"), value: card.tournaments_won },
    { label: t("users.list.expanded.mapsLabel"), value: card.maps },
    {
      label: t("users.list.table.winrate"),
      value:
        winratePct === null ? (
          "-"
        ) : (
          <span style={{ color: winrateColor(winratePct) }}>{winratePct.toFixed(0)}%</span>
        )
    },
    { label: t("users.list.table.avgPlacement"), value: formatOptional(card.avg_placement) },
    {
      label: t("users.list.table.bestPlacement"),
      value: card.best_placement ? <PlaceBadge place={card.best_placement} /> : "-"
    }
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="flex flex-col gap-1 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-2)] px-3 py-2"
        >
          <Label>{cell.label}</Label>
          <span className="font-semibold tabular-nums text-[color:var(--aqt-fg)]">{cell.value}</span>
        </div>
      ))}
    </div>
  );
}
