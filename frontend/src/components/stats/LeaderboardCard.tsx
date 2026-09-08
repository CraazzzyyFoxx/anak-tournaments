import React from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PlaceBadge } from "@/components/ui/place-badge";
import type { PlayerStatistics } from "@/types/statistics.types";

/**
 * Accent is a token name rather than a colour string so a caller cannot
 * reintroduce a hardcoded value — the whole point of this consolidation.
 */
type LeaderboardAccent = "teal" | "emerald" | "amber" | "blue" | "violet" | "rose";

const ACCENT: Record<LeaderboardAccent, string> = {
  teal: "var(--aqt-teal)",
  emerald: "var(--aqt-emerald)",
  amber: "var(--aqt-amber)",
  blue: "var(--aqt-blue)",
  violet: "var(--aqt-violet)",
  rose: "var(--aqt-rose)"
};

export interface LeaderboardCardProps {
  title: string;
  icon?: React.ReactNode;
  rows: PlayerStatistics[];
  /** Renders the metric — `${v}×`, a percentage, a duration. */
  format: (value: number) => string;
  accent: LeaderboardAccent;
}

/**
 * The single player-leaderboard surface.
 *
 * Replaces the statistics page's local copy plus `ChampionsTable` and
 * `TopWinratePlayersTable`, which were an English-only, medal-less duplicate of
 * the same thing rendered as a shadcn `<Table>`.
 */
export async function LeaderboardCard({ title, icon, rows, format, accent }: Readonly<LeaderboardCardProps>) {
  const t = await getTranslations();
  const accentColor = ACCENT[accent];

  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)]">
      <div className="flex items-center gap-2 border-b border-[color:var(--aqt-border)] px-5 py-4 font-display text-ui font-bold uppercase tracking-[0.04em] text-[color:var(--aqt-fg)]">
        {icon}
        {title}
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[color:var(--aqt-fg-muted)]">{t("common.noData")}</p>
      ) : (
        <ol>
          {rows.map((player, index) => (
            <li
              key={player.id}
              className="flex items-center justify-between border-b border-[color:var(--aqt-border)] px-5 py-2.5 text-caption text-[color:var(--aqt-fg)] transition-colors last:border-b-0 hover:bg-[color:var(--aqt-overlay-2)]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {index < 3 ? (
                  <PlaceBadge place={index + 1} className="shrink-0" />
                ) : (
                  <span className="min-w-[22px] text-center text-label tabular-nums text-[color:var(--aqt-fg-dim)]">
                    #{index + 1}
                  </span>
                )}
                <Link
                  href={`/users/${player.name.replace("#", "-")}`}
                  title={player.name}
                  className="truncate font-semibold transition-colors hover:text-[color:var(--aqt-fg-muted)]"
                >
                  {player.name}
                </Link>
              </div>
              <span
                className="min-w-[44px] text-right font-bold tabular-nums"
                style={{ color: accentColor }}
              >
                {format(player.value)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
