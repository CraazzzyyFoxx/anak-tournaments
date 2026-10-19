"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import StatsTableView from "@/components/match/StatsTable";
import { PageStateCard } from "@/components/ui/page-state-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DisciplineWidget } from "@/disciplines/DisciplineWidget";
import { loadMatchUI } from "@/disciplines/registry/match";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { buildMatchTable, matchSegments } from "@/lib/stats/table";
import type { StatDefinition } from "@/types/discipline.types";
import type { MatchWithStats } from "@/types/encounter.types";

/**
 * The working generic view of a native match: every participation (any number) with its observed members, one
 * declared stat per column, for the selected segment. Used where no module renderer applies (another game, or
 * a match that is not a duel) and while a module's renderer loads.
 */
function GenericMatchStatistics({
  match,
  defs
}: Readonly<{ match: MatchWithStats; defs: readonly StatDefinition[] }>) {
  const t = useTranslations();
  const segments = matchSegments(match);
  const [segment, setSegment] = useState(0);
  const active = segments.includes(segment) ? segment : 0;
  const table = useMemo(() => buildMatchTable(match, defs, active), [match, defs, active]);

  const label = (value: number) => {
    if (value === 0) return t("matches.allMatch");
    const kind =
      match.statistics.segments.find((candidate) => candidate.segment === value)?.kind ?? "";
    return t("matches.native.segment", { kind, n: value });
  };

  return (
    <div className="flex flex-col gap-3">
      {segments.length > 1 ? (
        <div className="flex items-center gap-2">
          <span className="aqt-tnum text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]">
            {t("matches.native.segmentLabel")}
          </span>
          <Select value={String(active)} onValueChange={(value) => setSegment(Number(value))}>
            <SelectTrigger className="h-8 w-[170px] text-caption">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {segments.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {label(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {table.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("matches.native.noStats")}</p>
      ) : null}
      <StatsTableView table={table} />
    </div>
  );
}

/**
 * The statistics of one match: the discipline's own scoreboard when its module has one for this shape (a duel),
 * the generic table of the declared stats otherwise. The match's own game (`workspace_id` + `discipline`)
 * decides — never the page's browsing game.
 */
export default function MatchStatistics({ match }: Readonly<{ match: MatchWithStats }>) {
  const metadata = useDisciplineMetadata(match.workspace_id, match.discipline);

  if (metadata.isPending) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (metadata.isError)
    return <PageStateCard state="error" onAction={() => void metadata.refetch()} />;

  return (
    <DisciplineWidget
      discipline={match.discipline}
      load={loadMatchUI}
      slot="matchStats"
      capabilities={metadata.data.discipline.capabilities}
      applicable={match.participants.length === 2}
      props={{ match, metadata: metadata.data }}
      fallback={<GenericMatchStatistics match={match} defs={metadata.data.stat_defs} />}
    />
  );
}
