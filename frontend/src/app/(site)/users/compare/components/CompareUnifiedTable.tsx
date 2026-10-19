"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { CardSurface } from "@/components/profile/atoms";
import CatalogEntityImage from "@/components/catalog/CatalogEntityImage";
import { Skeleton } from "@/components/ui/skeleton";
import { CompareRow } from "@/app/(site)/users/compare/types";
import { formatDuration, formatMetricValue } from "@/app/(site)/users/compare/utils";
import TrendDelta from "@/app/(site)/users/compare/components/TrendDelta";

interface HeroInfo {
  name?: string;
  imagePath?: string;
  dominantColor?: string | null;
  playtimeSeconds?: number;
  playtimeLabel?: string;
}

interface CompareUnifiedTableProps {
  subjectName: string;
  baselineName: string;
  rows: CompareRow[];
  loading: boolean;
  refreshing?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  isHeroScope: boolean;
  isTargetBaseline: boolean;
  subjectHero?: HeroInfo;
  baselineHero?: HeroInfo;
}

/* ------------------------------------------------------------------ */
/*  Bar ratio helper                                                   */
/* ------------------------------------------------------------------ */

const MIN_BAR_PERCENT = 8;

const computeBarPercents = (
  a: number | null,
  b: number | null
): { leftPercent: number; rightPercent: number } => {
  const safeA = a !== null && Number.isFinite(a) ? Math.abs(a) : 0;
  const safeB = b !== null && Number.isFinite(b) ? Math.abs(b) : 0;
  const max = Math.max(safeA, safeB);

  if (max === 0) return { leftPercent: 50, rightPercent: 50 };

  let leftPercent = (safeA / max) * 100;
  let rightPercent = (safeB / max) * 100;

  if (leftPercent > 0 && leftPercent < MIN_BAR_PERCENT) leftPercent = MIN_BAR_PERCENT;
  if (rightPercent > 0 && rightPercent < MIN_BAR_PERCENT) rightPercent = MIN_BAR_PERCENT;

  return { leftPercent, rightPercent };
};

const getRowWinner = (row: CompareRow): "left" | "right" | "tie" => {
  if (row.betterWorse === "better") return "left";
  if (row.betterWorse === "worse") return "right";
  return "tie";
};

/* Winner bar (emerald wash) vs neutral bar. */
const WINNER_BAR = "bg-[color:color-mix(in_srgb,var(--aqt-emerald)_55%,transparent)]";
const NEUTRAL_BAR = "bg-[hsl(0_0%_100%/0.14)]";

/* ------------------------------------------------------------------ */
/*  Metric row                                                         */
/* ------------------------------------------------------------------ */

const CompareMetricRow = ({ row }: { row: CompareRow }) => {
  const { leftPercent, rightPercent } = computeBarPercents(row.subjectValue, row.baselineValue);
  const winner = getRowWinner(row);

  const leftBarColor = winner === "left" ? WINNER_BAR : NEUTRAL_BAR;
  const rightBarColor = winner === "right" ? WINNER_BAR : NEUTRAL_BAR;

  const leftValueStyle =
    winner === "left" ? { color: "var(--aqt-emerald)" } : { color: "var(--aqt-fg)" };
  const rightValueStyle =
    winner === "right" ? { color: "var(--aqt-emerald)" } : { color: "var(--aqt-fg)" };

  return (
    <tr className="border-b border-[color:var(--aqt-border)] last:border-b-0 hover:bg-[hsl(0_0%_100%/0.02)]">
      <td
        className="truncate px-3.5 py-2.5 text-caption font-medium text-[color:var(--aqt-fg)]"
        title={row.label}
      >
        {row.label}
      </td>

      <td
        className={`aqt-tnum px-3 py-2.5 text-right text-caption tabular-nums whitespace-nowrap ${winner === "left" ? "font-bold" : ""}`}
        style={leftValueStyle}
      >
        {formatMetricValue(row.subjectValue)}
      </td>

      {/* Twin bars, mirrored around the column's centre line (where "vs" sits). */}
      <td className="px-3 py-2.5">
        <div className="mx-auto flex w-full max-w-[260px] items-center gap-1.5">
          <div className="flex h-2.5 flex-1 justify-end overflow-hidden rounded-l-sm bg-[hsl(0_0%_100%/0.04)]">
            <div
              className={`h-full rounded-l-sm transition-all duration-500 motion-reduce:transition-none ${leftBarColor}`}
              style={{ width: `${leftPercent}%` }}
            />
          </div>
          <div className="h-2.5 w-px shrink-0 bg-[color:var(--aqt-border)]" />
          <div className="flex h-2.5 flex-1 justify-start overflow-hidden rounded-r-sm bg-[hsl(0_0%_100%/0.04)]">
            <div
              className={`h-full rounded-r-sm transition-all duration-500 motion-reduce:transition-none ${rightBarColor}`}
              style={{ width: `${rightPercent}%` }}
            />
          </div>
        </div>
      </td>

      <td
        className={`aqt-tnum px-3 py-2.5 text-left text-caption tabular-nums whitespace-nowrap ${winner === "right" ? "font-bold" : ""}`}
        style={rightValueStyle}
      >
        {formatMetricValue(row.baselineValue)}
      </td>

      <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
        <TrendDelta
          delta={row.delta}
          deltaPercent={row.deltaPercent}
          betterWorse={row.betterWorse}
        />
      </td>
    </tr>
  );
};

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

const UnifiedSkeleton = ({ isHeroScope }: { isHeroScope: boolean }) => {
  const rowCount = isHeroScope ? 6 : 8;

  return (
    <tbody>
      {Array.from({ length: rowCount }).map((_, index) => (
        <tr
          key={`skeleton-row-${index}`}
          className="border-b border-[color:var(--aqt-border)] last:border-b-0"
        >
          <td className="px-3.5 py-2.5">
            <Skeleton className="h-4 w-40 max-w-full" />
          </td>
          <td className="px-3 py-2.5">
            <div className="flex justify-end">
              <Skeleton className="h-4 w-12" />
            </div>
          </td>
          <td className="px-3 py-2.5">
            <Skeleton className="mx-auto h-2.5 w-full max-w-[260px] rounded-sm" />
          </td>
          <td className="px-3 py-2.5">
            <Skeleton className="h-4 w-12" />
          </td>
          <td className="px-3.5 py-2.5">
            <div className="flex justify-end">
              <Skeleton className="h-4 w-16" />
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  );
};

/* ------------------------------------------------------------------ */
/*  Column identity (header cell over each value column)               */
/* ------------------------------------------------------------------ */

/** Name over its own value column, mirrored: the subject reads toward the bars
 *  from the left, the baseline from the right. */
const ColumnIdentity = ({
  name,
  caption,
  hero,
  align
}: {
  name: string;
  caption: string;
  hero?: HeroInfo;
  align: "left" | "right";
}) => {
  const t = useTranslations();
  const durationUnits = {
    h: t("common.duration.h"),
    m: t("common.duration.m"),
    s: t("common.duration.s")
  };
  const heroName = hero?.name ?? t("users.compare.allHeroes");

  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 ${align === "right" ? "flex-row-reverse text-right" : "text-left"}`}
    >
      {hero?.imagePath ? (
        <CatalogEntityImage
          entity={{ name: heroName, image_path: hero.imagePath }}
          size={36}
          rounded="lg"
          title={heroName}
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold normal-case tracking-normal text-[color:var(--aqt-fg)]" title={name}>
          {name}
        </span>
        <span className="truncate text-label font-medium normal-case tracking-normal text-[color:var(--aqt-fg-muted)]">
          {hero ? heroName : caption}
        </span>
        {hero?.playtimeSeconds !== undefined ? (
          <span className="aqt-tnum truncate text-label font-medium normal-case tracking-normal text-[color:var(--aqt-fg-dim)]">
            {hero.playtimeLabel ?? t("users.compare.playtime")}:{" "}
            {formatDuration(hero.playtimeSeconds, durationUnits)}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

const headBase =
  "aqt-tnum border-b border-[color:var(--aqt-border)] bg-[hsl(0_0%_100%/0.015)] py-3 align-bottom text-label font-bold uppercase tracking-label text-[color:var(--aqt-fg-faint)]";

const CompareUnifiedTable = ({
  subjectName,
  baselineName,
  rows,
  loading,
  refreshing = false,
  errorMessage,
  onRetry,
  isHeroScope,
  isTargetBaseline,
  subjectHero,
  baselineHero
}: CompareUnifiedTableProps) => {
  const t = useTranslations();
  const hasRows = !loading && rows.length > 0;
  const showError = Boolean(errorMessage) && !hasRows;

  return (
    <div
      aria-busy={loading || refreshing}
      className={refreshing ? "opacity-70 transition-opacity" : "transition-opacity"}
    >
      <CardSurface flush>
        <div
          className="overflow-x-auto"
          role="region"
          aria-label={t("users.compare.hero.title")}
          tabIndex={0}
        >
          {/* Fixed layout: every column keeps its width whatever the values, so
              the names in the header sit exactly over their numbers. */}
          <table className="aqt-tnum w-full min-w-[920px] table-fixed border-collapse text-caption">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[20%]" />
              <col />
              <col className="w-[20%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead>
              <tr>
                <th className={`${headBase} px-3.5 text-left`}>{t("users.compare.colMetric")}</th>
                <th className={`${headBase} px-3`}>
                  <ColumnIdentity
                    name={subjectName}
                    caption={t("users.compare.selectedUserColumn")}
                    hero={isHeroScope ? subjectHero ?? {} : undefined}
                    align="right"
                  />
                </th>
                <th className={`${headBase} px-3 text-center`}>{t("common.vs")}</th>
                <th className={`${headBase} px-3`}>
                  <ColumnIdentity
                    name={baselineName}
                    caption={
                      isTargetBaseline ? t("users.compare.compareAgainst") : t("users.compare.baseline")
                    }
                    hero={isHeroScope ? baselineHero ?? {} : undefined}
                    align="left"
                  />
                </th>
                <th className={`${headBase} px-3.5 text-right`}>
                  <abbr title={t("users.compare.colDeltaTitle")} className="no-underline">
                    {t("users.compare.colDelta")}
                  </abbr>
                </th>
              </tr>
            </thead>

            {loading ? (
              <UnifiedSkeleton isHeroScope={isHeroScope} />
            ) : showError ? (
              <tbody>
                <tr>
                  <td
                    colSpan={5}
                    className="px-3.5 py-10 text-center text-sm text-[color:var(--aqt-rose)]"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <span>{errorMessage}</span>
                      {onRetry ? (
                        <button
                          type="button"
                          onClick={onRetry}
                          className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-[color:var(--aqt-border)] px-3 text-xs font-semibold text-[color:var(--aqt-fg-muted)] transition-colors hover:text-[color:var(--aqt-fg)]"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {t("users.compare.retry")}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              </tbody>
            ) : !hasRows ? (
              <tbody>
                <tr>
                  <td
                    colSpan={5}
                    className="px-3.5 py-10 text-center text-sm text-[color:var(--aqt-fg-muted)]"
                  >
                    {t("users.compare.noMetrics")}
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody>
                {rows.map((row) => (
                  <CompareMetricRow key={row.key} row={row} />
                ))}
              </tbody>
            )}
          </table>
        </div>
      </CardSurface>
    </div>
  );
};

export default CompareUnifiedTable;
