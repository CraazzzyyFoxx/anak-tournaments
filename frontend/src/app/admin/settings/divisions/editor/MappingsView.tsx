"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { StatusPill } from "@/components/kit/StatusPill";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DivisionGridReadinessSource, DivisionTier } from "@/types/workspace.types";

import {
  autoMap,
  resolveTarget,
  unresolvedRows,
  type MappingChoice,
  type MappingChoices,
  type MappingRow,
  type MappingTarget
} from "./autoMap";
import { rankRangeLabel, type Band, type Ladder } from "./draftReducer";
import { MappingTargetPicker, targetSummary } from "./MappingTargetPicker";

export interface MappingSource {
  readiness: DivisionGridReadinessSource;
  tiers: DivisionTier[];
}

export interface MappingsViewProps {
  ladder: Ladder | null;
  targetLabel: string;
  bands: Band[];
  sources: MappingSource[];
  /** source tier id → choice: the stored mapping, overlaid with this session's picks. */
  chosen: MappingChoices;
  /** `null` returns the row to the automatic mapping. */
  onChoose: (sourceTierId: number, choice: MappingChoice | null) => void;
  editable: boolean;
  /**
   * `false` until the draft has been saved once: the rules key on target tier
   * ids, and an unsaved band has none.
   */
  mappable: boolean;
  loading: boolean;
}

function matchLabel(row: MappingRow, target: MappingTarget | null): string {
  if (target === null) return "SPLIT · choose";
  if (target.range.length > 1) {
    return `${target.manual ? "MANUAL" : "AUTO"} · ${target.range.length} divisions`;
  }
  const overlap = row.candidates.find((entry) => entry.band.slug === target.primary.slug);
  const share = overlap ? `${Math.round(overlap.weight * 100)}%` : "no overlap";
  return `${target.manual ? "MANUAL" : "AUTO"} · ${share}`;
}

/**
 * Mappings (F12b ·1) — where the players of every version a tournament still
 * reads land in this draft.
 *
 * Overlap on the rank scale proposes a target (AUTO); a tie needs a person
 * (SPLIT). Every row can be overridden with a range of divisions the players
 * spread over and the one they land in: when an older version sits on another
 * rank scale, overlap is only a guess and the organiser knows better. The
 * unresolved count here is the tab badge and the "Ready to publish?" blocker.
 */
export function MappingsView({
  ladder,
  targetLabel,
  bands,
  sources,
  chosen,
  onChoose,
  editable,
  mappable,
  loading
}: Readonly<MappingsViewProps>) {
  const t = useTranslations("adminSettings.divisions");
  const mapped = useMemo(
    () => sources.map((source) => ({ ...source, rows: autoMap(ladder, source.tiers, bands) })),
    [bands, ladder, sources]
  );

  if (!mappable) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("mappings.saveFirst")}
      </p>
    );
  }

  if (loading) return <Skeleton className="h-48 w-full rounded-xl" />;

  if (sources.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("mappings.noMapping")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {mapped.map(({ readiness, rows }) => {
        const unresolved = unresolvedRows(rows, chosen, bands);
        return (
          <section key={readiness.version_id} className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className={cn(EYEBROW_CLASS, "font-mono")}>
                {t("mappingLabels.header", {
                  source: readiness.version_label,
                  target: targetLabel,
                  tournaments: readiness.tournament_count,
                  divisions: rows.length
                })}
              </p>
              <StatusPill tone={unresolved.length === 0 ? "success" : "warning"}>
                {unresolved.length === 0 ? t("mappingLabels.complete") : t("mappingLabels.toResolve", { count: unresolved.length })}
              </StatusPill>
            </div>

            <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("table.versionDivision", { version: readiness.version_label })}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("table.rankRange")}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("table.players")}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("mappingLabels.inTarget", { target: targetLabel })}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t("mappingLabels.match")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const target = resolveTarget(row, chosen, bands);
                    const sourceTierId = row.source.id;
                    return (
                      <tr key={row.source.slug} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2">{row.source.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {rankRangeLabel(row.source)}
                        </td>
                        <td
                          className="px-3 py-2 text-muted-foreground"
                          title={t("table.playerDistributionUnavailable")}
                        >
                          &mdash;
                        </td>
                        <td className="px-3 py-2">
                          {editable && sourceTierId !== undefined ? (
                            <MappingTargetPicker
                              row={row}
                              bands={bands}
                              target={target}
                              onChange={(choice) => onChoose(sourceTierId, choice)}
                            />
                          ) : target ? (
                            targetSummary(target)
                          ) : (
                            <span className="text-warning">{t("mappings.unresolved")}</span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 font-mono text-xs",
                            target === null ? "text-warning" : "text-muted-foreground"
                          )}
                        >
                          {matchLabel(row, target)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
