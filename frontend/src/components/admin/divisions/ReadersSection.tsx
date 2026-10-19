"use client";

import { useTranslations } from "next-intl";

import { EmptyNote } from "@/components/kit/EmptyNote";
import { StatusPill } from "@/components/kit/StatusPill";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  DivisionGridReadinessSource,
  DivisionGridVersion
} from "@/types/workspace.types";

import { MONO_CAPTION } from "./model";

const SOURCE_STATUS_TONE = {
  ok: "success",
  incomplete: "warning",
  missing: "danger"
} as const;

const SOURCE_STATUS_LABEL = {
  ok: "impact.mappingComplete",
  incomplete: "impact.mappingIncomplete",
  missing: "impact.noMapping"
} as const;

/** The older versions tournaments still read, from the active version's readiness. */
export function ReadersSection({
  activeVersion,
  loading,
  sources
}: Readonly<{
  activeVersion: DivisionGridVersion | null;
  loading: boolean;
  sources: DivisionGridReadinessSource[];
}>) {
  const t = useTranslations("adminSettings.divisions");
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="divisions-readers">
      <h2 id="divisions-readers" className="font-display text-base font-semibold">
        {t("readersTitle")}
      </h2>
      {!activeVersion ? (
        <p className="text-xs text-muted-foreground">{t("readersDescription")}</p>
      ) : loading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : sources.length === 0 ? (
        <EmptyNote size="sm">{t("nothingToMap", { version: activeVersion.version })}</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-3">
          {sources.map((source) => (
            <SourceCard key={source.version_id} source={source} target={activeVersion} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One older version tournaments still read, and whether its divisions have a
 * way into the version in force. The readiness payload names the five newest
 * tournaments and counts all of them, so the list is shown as a sample, never
 * as the whole.
 */
function SourceCard({
  source,
  target
}: Readonly<{ source: DivisionGridReadinessSource; target: DivisionGridVersion }>) {
  const t = useTranslations("adminSettings.divisions");
  const hidden = source.tournament_count - source.tournament_names.length;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={source.version_label}>
            {source.version_label}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={source.grid_name}>
            {source.grid_name}
          </p>
        </div>
        <StatusPill tone={SOURCE_STATUS_TONE[source.status]}>
          {t(SOURCE_STATUS_LABEL[source.status])}
        </StatusPill>
      </div>

      <p className={MONO_CAPTION}>{t("tournamentCount", { count: source.tournament_count })}</p>
      {source.tournament_names.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs">
          {source.tournament_names.map((name) => (
            <li key={name} className="truncate" title={name}>
              {name}
            </li>
          ))}
          {hidden > 0 ? (
            <li className="text-muted-foreground">{t("more", { count: hidden })}</li>
          ) : null}
        </ul>
      ) : null}

      {source.status === "ok" ? null : (
        <p className="text-xs text-muted-foreground">
          {source.status === "missing"
            ? t("sourceMissing", { version: target.version })
            : t("sourceIncomplete", {
                count: source.conflict_tiers.length,
                version: target.version
              })}{" "}
          {t("sourceAction")}
        </p>
      )}
    </li>
  );
}
