"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, UserPlus } from "lucide-react";

import { TournamentCombobox } from "@/components/admin/TournamentCombobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfiniteScrollFooter } from "@/components/ui/infinite-scroll";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { useFormatter } from "@/lib/datetime/client";
import type { Tournament } from "@/types/tournament.types";

import type { RuleUserRow, RuleUsersView } from "../_hooks/useAchievementDetail";

function SortableHead({
  field,
  label,
  view,
  onSort
}: Readonly<{
  field: string;
  label: string;
  view: RuleUsersView;
  onSort: (field: string) => void;
}>) {
  const isActive = view.sort === field;
  return (
    <TableHead aria-sort={isActive ? (view.order === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => onSort(field)}
      >
        {label}
        {isActive ? (
          view.order === "asc" ? (
            <ArrowUp aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown aria-hidden className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUp aria-hidden className="h-3.5 w-3.5 opacity-0 group-hover:opacity-30" />
        )}
      </button>
    </TableHead>
  );
}

/** Who has earned this achievement, filtered by tournament and paged on scroll. */
export function AchievementUsersCard({
  pages,
  totalUsers,
  tournaments,
  view,
  onViewChange,
  onAddOverride,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  isError
}: Readonly<{
  pages: { results: RuleUserRow[] }[];
  totalUsers: number;
  tournaments: Tournament[];
  view: RuleUsersView;
  onViewChange: (next: RuleUsersView) => void;
  onAddOverride: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  isError: boolean;
}>) {
  const t = useTranslations("adminAchievements");
  const format = useFormatter();

  // Clicking the active column flips its direction; a new column starts descending.
  const handleSort = (field: string) =>
    onViewChange(
      view.sort === field
        ? { ...view, order: view.order === "asc" ? "desc" : "asc" }
        : { ...view, sort: field, order: "desc" }
    );

  const loaded = pages.reduce((count, page) => count + page.results.length, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{t("detail.userCount", { count: totalUsers })}</CardTitle>
          <CardDescription>{t("detail.playersEarned")}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-64">
            <TournamentCombobox
              tournaments={tournaments}
              value={view.tournamentId}
              onSelect={(t) => onViewChange({ ...view, tournamentId: t?.id })}
              placeholder={t("detail.allTournaments")}
            />
          </div>
          <Button variant="outline" size="sm" onClick={onAddOverride}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t("detail.manualOverride")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead field="user_name" label={t("common.user")} view={view} onSort={handleSort} />
              <SortableHead field="count" label={t("common.count")} view={view} onSort={handleSort} />
              <SortableHead
                field="last_tournament_id"
                label={t("common.lastTournament")}
                view={view}
                onSort={handleSort}
              />
              <SortableHead
                field="first_qualified"
                label={t("common.firstEarned")}
                view={view}
                onSort={handleSort}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.map((page) =>
              page.results.map((row) => (
                <TableRow key={row.user_id}>
                  <TableCell>
                    <Link href={`/users/${row.user_id}`} className="text-primary hover:underline">
                      {row.user_name}
                    </Link>
                  </TableCell>
                  <TableCell>{row.count}</TableCell>
                  <TableCell>
                    {row.last_tournament_id ? (
                      <Link
                        href={`/tournaments/${row.last_tournament_id}`}
                        className="text-primary hover:underline"
                      >
                        #{row.last_tournament_id}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.first_qualified
                      ? format.dateTime(new Date(row.first_qualified), { dateStyle: "medium" })
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
            {totalUsers === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  {t("detail.noUsers")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {totalUsers > 0 ? (
          <InfiniteScrollFooter
            className="mt-4"
            loaded={loaded}
            total={totalUsers}
            unit="users"
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            isError={isError}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
