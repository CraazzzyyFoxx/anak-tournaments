"use client";

import React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { LayoutGrid, ArrowUpRight } from "lucide-react";

import type { Tournament } from "@/types/tournament.types";
import { cn, formatDateRange } from "@/lib/utils";
import { getTournamentStatusMeta } from "@/lib/tournament-status";
import { DataPagination } from "@/components/ui/data-pagination";
import { relativeTime, stageProgress } from "./tournaments-helpers";

const TournamentRow = ({ tournament }: { tournament: Tournament }) => {
  const t = useTranslations();
  const locale = useLocale();
  const { variant } = getTournamentStatusMeta(tournament.status);
  const stage = stageProgress(tournament, tournament.status, t);
  const players = tournament.participants_count ?? 0;

  return (
    <tr className="relative">
      <td>
        {/* Row-wide stretched link. The row *looks* clickable (`cursor: pointer`
            in the shared table CSS) and used to be driven by `onClick` on the
            <tr>, which made it unreachable by keyboard and invisible to AT.
            This keeps the whole-row target while being a real, focusable,
            announced link whose focus ring outlines the entire row. */}
        <Link
          href={`/tournaments/${tournament.id}`}
          aria-label={t("tournamentsList.row.openAria", { name: tournament.name })}
          className="absolute inset-0 z-[1] rounded-[2px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]"
        />
        <div className="tn-name-cell">
          <span className="nm">
            {tournament.name}
            {(tournament.status === "live" || tournament.status === "playoffs") && (
              <span className="status-pill live" style={{ fontSize: "8.5px", padding: "2px 7px" }}>
                <span aria-hidden className="dot" />
                {t("common.live")}
              </span>
            )}
            {tournament.is_hidden && (
              <span
                className="status-pill"
                style={{
                  fontSize: "8.5px",
                  padding: "2px 7px",
                  background: "hsl(var(--muted) / 0.6)",
                  color: "hsl(var(--muted-foreground))",
                  border: "1px solid hsl(var(--border))"
                }}
              >
                {t("common.previewBadge")}
              </span>
            )}
          </span>
          <span className="sub">
            {formatDateRange(tournament.start_date, tournament.end_date, locale)}
            {tournament.is_league && (
              <>
                <span className="sep">·</span>
                {t("common.league")}
              </>
            )}
            {tournament.team_formation && (
              <>
                <span className="sep">·</span>
                {tournament.team_formation === "draft" ? t("common.draft") : t("common.balancer")}
              </>
            )}
          </span>
        </div>
      </td>
      <td>
        <span className={`tn-status ${variant}`}>
          <span aria-hidden className="dot" />
          {t(`common.statusBadge.${tournament.status}`)}
        </span>
      </td>
      <td>
        <div className="tn-stage">
          <span className="stage-label">{stage.label}</span>
          <div className="progress">
            <div
              className={cn(
                "fill",
                stage.fill === "amber" && "amber",
                stage.fill === "muted" && "muted"
              )}
              style={{ width: `${stage.pct}%` }}
            />
          </div>
        </div>
      </td>
      <td>
        <div className="tn-teams">
          <div className="stack">
            <span className="big tabular-nums">{players}</span>
            <span className="sub">{t("common.players")}</span>
          </div>
        </div>
      </td>
      <td className="r">
        <span className="tn-id">
          {relativeTime(tournament.updated_at ?? tournament.start_date, t)}
        </span>
      </td>
      <td className="r">
        {/* z-[2] keeps these above the stretched row link so they stay
            independently clickable. */}
        <div className="tn-actions relative z-[2]">
          <Link
            href={`/tournaments/${tournament.id}/bracket`}
            className="icon-btn"
            aria-label={t("tournamentsList.row.bracketAria", { name: tournament.name })}
          >
            <LayoutGrid aria-hidden width={13} height={13} />
          </Link>
          <Link
            href={`/tournaments/${tournament.id}`}
            className="icon-btn"
            aria-label={t("tournamentsList.row.openAria", { name: tournament.name })}
          >
            <ArrowUpRight aria-hidden width={13} height={13} />
          </Link>
        </div>
      </td>
    </tr>
  );
};

interface TournamentsTableProps {
  tournaments: Tournament[];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

const TournamentsTable = ({ tournaments, page, pageSize, onPageChange }: TournamentsTableProps) => {
  const t = useTranslations();
  const total = tournaments.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = tournaments.slice(start, start + pageSize);
  const rangeStart = total === 0 ? 0 : start + 1;
  const rangeEnd = Math.min(start + pageSize, total);

  return (
    <section className="tn-card">
      <table className="tn">
        <thead>
          <tr>
            <th scope="col">{t("common.tournament")}</th>
            <th scope="col" style={{ width: 120 }}>
              {t("common.status")}
            </th>
            <th scope="col" style={{ width: 170 }}>
              {t("common.stage")}
            </th>
            <th scope="col" style={{ width: 110 }}>
              {t("common.playersLabel")}
            </th>
            <th scope="col" className="r" style={{ width: 110 }}>
              {t("common.updated")}
            </th>
            <th scope="col" className="r" style={{ width: 80 }}>
              <span className="sr-only">{t("common.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((tournament) => (
            <TournamentRow key={tournament.id} tournament={tournament} />
          ))}
        </tbody>
      </table>

      <DataPagination
        className="pagination"
        page={safePage}
        totalPages={totalPages}
        onPageChange={onPageChange}
        summary={t("common.showingRange", {
          start: String(rangeStart),
          end: String(rangeEnd),
          total: String(total)
        })}
      />
    </section>
  );
};

export default TournamentsTable;
