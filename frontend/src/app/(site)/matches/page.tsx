"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { Filter } from "lucide-react";

import tournamentService from "@/services/tournament.service";
import encounterService from "@/services/encounter.service";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { DataPagination } from "@/components/ui/data-pagination";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import TeamName from "@/components/TeamName";
import { useQueryParams } from "@/hooks/useQueryParams";

const PAGE_SIZE = 10;

const MatchesTableSkeleton = () => (
  <div className="flex flex-col gap-1.5">
    {Array.from({ length: 8 }).map((_, index) => (
      <Skeleton key={index} className="h-12 w-full rounded-lg" />
    ))}
  </div>
);

const MatchesPage = () => {
  const t = useTranslations();
  const { searchParams, setParams } = useQueryParams({ resetOnChange: ["page"] });

  // Both filter and page are read straight back out of the URL, so a reload or a
  // shared link restores exactly the view the user was looking at. The tournament
  // filter used to live in component state only: the URL claimed a filter, the
  // request never carried one, and a reload silently reset the Select.
  const page = Number.parseInt(searchParams?.get("page") ?? "1", 10) || 1;
  const tournamentIdParam = searchParams?.get("tournamentId") ?? null;
  const tournamentId = tournamentIdParam ? Number(tournamentIdParam) : null;
  const activeTournamentId = tournamentId != null && Number.isFinite(tournamentId) ? tournamentId : null;

  const { data: tournamentsData } = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentService.getAll()
  });

  const matchesQuery = useQuery({
    queryKey: ["matches", page, activeTournamentId],
    queryFn: () => encounterService.getAllMatches(page, PAGE_SIZE, "", activeTournamentId)
  });

  const matchesData = matchesQuery.data;
  const rows = matchesData?.results ?? [];
  const totalPages = Math.max(1, Math.ceil((matchesData?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--aqt-fg)]">
            {t("common.matches")}
          </h1>
          {matchesData && (
            <p className="mt-1 text-sm tabular-nums text-[color:var(--aqt-fg-dim)]">
              {t("matches.matchesTotal", { count: matchesData.total })}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <Filter aria-hidden className="h-3.5 w-3.5 shrink-0 text-[color:var(--aqt-fg-faint)]" />
          <Select
            value={activeTournamentId?.toString() ?? "all"}
            onValueChange={(value) =>
              setParams({ tournamentId: value === "all" ? null : value })
            }
          >
            <SelectTrigger
              aria-label={t("matches.allTournaments")}
              className="h-8 w-full border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] text-sm text-[color:var(--aqt-fg-muted)] shadow-none hover:border-[color:var(--aqt-border-2)] hover:bg-[color:var(--aqt-overlay-2)] sm:w-64"
            >
              <SelectValue placeholder={t("matches.allTournaments")} />
            </SelectTrigger>
            <SelectContent className="max-h-[min(var(--radix-select-content-available-height),20rem)]">
              <SelectItem value="all">{t("matches.allTournaments")}</SelectItem>
              <SelectGroup>
                {tournamentsData?.results.map((item) => (
                  <SelectItem key={item.id} value={item.id.toString()}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {matchesQuery.isError ? (
        <PageStateCard state="error" onAction={() => void matchesQuery.refetch()} />
      ) : matchesQuery.isPending ? (
        <MatchesTableSkeleton />
      ) : rows.length === 0 ? (
        <PageStateCard
          state={activeTournamentId != null ? "filtered-empty" : "empty"}
          description={t("matches.noMatchesFound")}
          onAction={
            activeTournamentId != null ? () => setParams({ tournamentId: null }) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-xl border border-[color:var(--aqt-border)]">
            <ScrollArea>
              <table className="w-full caption-bottom text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--aqt-border)]">
                    {[
                      t("matches.col.map"),
                      t("common.tournament"),
                      t("common.stage"),
                      t("matches.col.match"),
                      t("matches.col.score")
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="h-8 whitespace-nowrap px-3 text-left text-label font-semibold uppercase tracking-wide text-[color:var(--aqt-fg-faint)]"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((match) => {
                    const stageLabel =
                      match.encounter?.stage_item?.name ??
                      match.encounter?.stage?.name ??
                      t("common.unassignedStage");

                    return (
                      <tr
                        key={match.id}
                        className="border-b border-[color:var(--aqt-border)] transition-colors last:border-0 hover:bg-[color:var(--aqt-overlay-1)]"
                      >
                        <td className="p-0 align-middle">
                          {/* A real anchor, so the row is keyboard reachable,
                              announced as a link, and middle-clickable. */}
                          <Link
                            href={`/matches/${match.id}`}
                            className="flex items-center gap-3 px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--aqt-teal)]"
                          >
                            <span className="relative h-12 w-40 shrink-0 overflow-hidden rounded-md bg-[color:var(--aqt-overlay-2)]">
                              {match.map ? (
                                <Image
                                  src={match.map.image_path}
                                  alt=""
                                  fill
                                  style={{ objectFit: "cover" }}
                                  className="brightness-75"
                                />
                              ) : null}
                            </span>
                            <span className="whitespace-nowrap text-sm font-medium text-[color:var(--aqt-fg)]">
                              {match.map?.name ?? "—"}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span className="text-sm text-[color:var(--aqt-fg-muted)]">
                            {match.encounter?.tournament.name}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span className="inline-flex items-center rounded-full border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-1)] px-2 py-0.5 text-label text-[color:var(--aqt-fg-muted)]">
                            {stageLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <TeamName
                            team={match.home_team}
                            size="xs"
                            nameClassName="text-sm text-[color:var(--aqt-fg)]"
                          />
                          <span className="mx-1.5 text-sm text-[color:var(--aqt-fg-faint)]">
                            {t("common.vs")}
                          </span>
                          <TeamName
                            team={match.away_team}
                            size="xs"
                            nameClassName="text-sm text-[color:var(--aqt-fg)]"
                          />
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span className="text-sm font-semibold tabular-nums text-[color:var(--aqt-fg)]">
                            {match.score.home}
                            <span className="mx-0.5 text-[color:var(--aqt-fg-faint)]">–</span>
                            {match.score.away}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
          <DataPagination
            page={page}
            totalPages={totalPages}
            onPageChange={(nextPage) => setParams({ page: nextPage })}
          />
        </div>
      )}
    </div>
  );
};

const MatchesPageWrapper = () => (
  // `useSearchParams` needs a Suspense boundary; the fallback is the same
  // skeleton the loaded page uses, not a bare "Loading…" line.
  <Suspense fallback={<MatchesTableSkeleton />}>
    <MatchesPage />
  </Suspense>
);

export default MatchesPageWrapper;
