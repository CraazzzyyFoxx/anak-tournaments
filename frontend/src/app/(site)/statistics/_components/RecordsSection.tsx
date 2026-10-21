import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import {
  Column,
  ColumnHead,
  EmptyNote,
  EYEBROW_CLASS,
  LoadError,
  Section,
  SectionHead
} from "@/components/site/open-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCloseness } from "@/lib/encounter/detail";
import type { Formatter } from "@/lib/datetime";
import { getFormatter } from "@/lib/datetime/server";
import { getPlayerSlug } from "@/lib/player";
import { isTenantHost } from "@/lib/site/tenant-host";
import { tournamentHref } from "@/lib/tournament/url";
import { cn } from "@/lib/utils";
import statisticsService from "@/services/statistics.service";
import type { StatRecord, StatRecordCode } from "@/types/statistics.types";

import { clock, splitBattleTag } from "./statistics.model";

const TITLE_ID = "stats-records-title";

/** Read from results, so every game has them; the rest come from one game's parsed logs. */
const FEATURED: readonly StatRecordCode[] = ["win_streak", "biggest_upset", "underdog_champion", "closest_final"];

const FEATURED_GRID_CLASS = "grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-4";
const LINK_CLASS =
  "rounded-sm text-[color:var(--aqt-fg)] transition-colors hover:text-[color:var(--aqt-teal)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--aqt-teal)]";

function Shell({ discipline, children }: Readonly<{ discipline: string | null; children: ReactNode }>) {
  const t = useTranslations("statistics.records");
  return (
    <Section labelledBy={TITLE_ID}>
      <SectionHead title={t("title")} titleId={TITLE_ID} sub={discipline ? t("subGame") : t("sub")} />
      {children}
    </Section>
  );
}

/** The figure, and the dim words saying what it counts. `lg` for a featured record, `md` for a log row. */
function Figure({ record, format, size }: Readonly<{ record: StatRecord; format: Formatter; size: "lg" | "md" }>) {
  const t = useTranslations("statistics.records");
  const { value } = record;
  let figure = format.number(value, { maximumFractionDigits: 0 });
  let unit: string | null = null;
  switch (record.code) {
    case "win_streak":
      unit = t("unit.streak", { count: value });
      break;
    case "biggest_upset":
      figure = `−${figure} SR`;
      unit = record.relative === null ? null : t("unit.upset", { pct: format.number(record.relative, { style: "percent" }) });
      break;
    case "underdog_champion":
      figure = t("ofTotal", { value, total: record.of_total ?? value });
      unit = t("unit.underdog");
      break;
    case "closest_final":
      figure = formatCloseness(value) ?? figure;
      unit = t("unit.closeness");
      break;
    case "most_mvps":
      unit = t("unit.mvps", { count: value });
      break;
    case "longest_map":
      figure = clock(value);
      break;
  }
  return size === "lg" ? (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-display text-headline font-semibold tabular-nums text-[color:var(--aqt-fg)]">{figure}</span>
      {unit ? <span className="text-caption text-[color:var(--aqt-fg-dim)]">{unit}</span> : null}
    </p>
  ) : (
    <p className="text-right">
      <span className="block font-display text-title font-semibold tabular-nums text-[color:var(--aqt-fg)]">
        {figure}
      </span>
      {unit ? <span className="text-label text-[color:var(--aqt-fg-dim)]">{unit}</span> : null}
    </p>
  );
}

/** Who holds it: a player (linked to the profile), else the team. */
function Holder({ record, className }: Readonly<{ record: StatRecord; className: string }>) {
  if (record.player) {
    const [nick, tag] = splitBattleTag(record.player.name);
    return (
      <p className={className}>
        <Link
          href={`/users/${getPlayerSlug(record.player.name)}`}
          prefetch={false}
          title={record.player.name}
          className={LINK_CLASS}
        >
          {nick}
          {tag ? <span className="font-normal text-[color:var(--aqt-fg-faint)]">{tag}</span> : null}
        </Link>
      </p>
    );
  }
  return record.team ? (
    <p className={className} title={record.team.name}>
      {record.team.name}
    </p>
  ) : null;
}

/** Where it happened, one `·`-joined meta line: the matchup, the series score, the map, the tournament, the dates. */
function Context({ record, format, className }: Readonly<{ record: StatRecord; format: Formatter; className: string }>) {
  const t = useTranslations("statistics.records");
  const parts: ReactNode[] = [];
  if (record.opponent) {
    parts.push(
      record.player && record.team
        ? t("matchup", { team: record.team.name, opponent: record.opponent.name })
        : t("against", { opponent: record.opponent.name })
    );
  }
  if (record.score) {
    const score = `${record.score[0]}:${record.score[1]}`;
    parts.push(
      record.encounter_id === null ? (
        score
      ) : (
        <Link href={`/encounters/${record.encounter_id}`} prefetch={false} className={cn("aqt-tnum", LINK_CLASS)}>
          {score}
        </Link>
      )
    );
  }
  if (record.map) {
    parts.push(
      record.match_id === null ? (
        record.map.name
      ) : (
        <Link href={`/matches/${record.match_id}`} prefetch={false} className={LINK_CLASS}>
          {record.map.name}
        </Link>
      )
    );
  }
  if (record.tournament) {
    parts.push(
      <Link href={tournamentHref(record.tournament.id)} prefetch={false} className={LINK_CLASS}>
        {record.tournament.name}
      </Link>
    );
  }
  if (record.started_at && record.ended_at) {
    parts.push(
      format.dateTimeRange(new Date(record.started_at), new Date(record.ended_at), {
        day: "numeric",
        month: "short",
        year: "numeric"
      })
    );
  }
  if (parts.length === 0) return null;
  return (
    <p className={cn("text-caption text-[color:var(--aqt-fg-muted)]", className)}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className="text-[color:var(--aqt-fg-dim)]"> · </span> : null}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The almanac's records: the results-based ones large, one game's log records as compact rows under them. A record
 * the server has no data for is simply not in the list.
 */
export async function RecordsSection({ discipline }: Readonly<{ discipline: string | null }>) {
  const skipWorkspace = !(await isTenantHost());
  const [t, format, data] = await Promise.all([
    getTranslations("statistics.records"),
    getFormatter(),
    statisticsService.getRecords(discipline, { skipWorkspace }).catch(() => null)
  ]);

  if (data === null) {
    return (
      <Shell discipline={discipline}>
        <LoadError what={t("what")} dashed />
      </Shell>
    );
  }
  if (data.records.length === 0) {
    return (
      <Shell discipline={discipline}>
        <EmptyNote>{t("empty")}</EmptyNote>
      </Shell>
    );
  }

  const featured = data.records.filter((record) => FEATURED.includes(record.code));
  const fromLogs = data.records.filter((record) => !FEATURED.includes(record.code));

  return (
    <Shell discipline={discipline}>
      {featured.length > 0 ? (
        <div className={FEATURED_GRID_CLASS}>
          {featured.map((record) => (
            <article key={record.code} className="min-w-0 border-t border-[color:var(--aqt-border-3)] pt-4">
              <h3 className={EYEBROW_CLASS}>{t(`code.${record.code}`)}</h3>
              <Figure record={record} format={format} size="lg" />
              <Holder record={record} className="mt-2.5 truncate text-ui font-semibold text-[color:var(--aqt-fg)]" />
              <Context record={record} format={format} className="mt-1" />
            </article>
          ))}
        </div>
      ) : null}
      {fromLogs.length > 0 ? (
        <Column className={featured.length > 0 ? "mt-10" : undefined}>
          <ColumnHead title={t("fromLogs")} />
          <ul className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
            {fromLogs.map((record) => (
              <li
                key={record.code}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-[color:var(--aqt-border)] py-3"
              >
                <div className="min-w-0">
                  <h4 className={EYEBROW_CLASS}>{t(`code.${record.code}`)}</h4>
                  <Holder record={record} className="mt-1 truncate text-body font-semibold text-[color:var(--aqt-fg)]" />
                  <Context record={record} format={format} className="mt-0.5" />
                </div>
                <Figure record={record} format={format} size="md" />
              </li>
            ))}
          </ul>
        </Column>
      ) : null}
    </Shell>
  );
}

export function RecordsSkeleton({ discipline }: Readonly<{ discipline: string | null }>) {
  return (
    <Shell discipline={discipline}>
      <div aria-hidden className={FEATURED_GRID_CLASS}>
        {FEATURED.map((code) => (
          <div key={code} className="border-t border-[color:var(--aqt-border-3)] pt-4">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-3 h-8 w-24" />
            <Skeleton className="mt-2.5 h-5 w-40" />
            <Skeleton className="mt-1.5 h-4 w-full max-w-56" />
          </div>
        ))}
      </div>
    </Shell>
  );
}
