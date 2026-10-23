"use client";

import { CircleDot, Clock } from "lucide-react";
import { useTranslations } from "next-intl";

import { StatusIcon } from "@/components/admin/StatusIcon";
import { StatusPill } from "@/components/kit/StatusPill";
import { useFormatter } from "@/lib/datetime/client";
import type { Encounter } from "@/types/encounter.types";

/** The stage or stage item an encounter was scheduled under; empty when it has neither. */
export function encounterScopeLabel(encounter: Encounter): string {
  return encounter.stage_item?.name ?? encounter.stage?.name ?? "";
}

const STATUS_KEYS = { OPEN: "open", PENDING: "pending", COMPLETED: "completed" } as const;

/**
 * The `adminMatches.encounters` key naming an encounter status, whatever case
 * the wire spells it in (the reports endpoint sends `completed`, the encounter
 * list `COMPLETED`); `null` for a status the panel has no word for.
 */
export function encounterStatusKey(status?: string | null): (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS] | null {
  return STATUS_KEYS[status?.toUpperCase() as keyof typeof STATUS_KEYS] ?? null;
}

/**
 * The encounter's status, for the two states still waiting on something.
 * Completed is what most rows are, so it is the absence of an icon.
 */
export function EncounterStatusCell({ status }: Readonly<{ status?: string | null }>) {
  const t = useTranslations("adminMatches.encounters");
  const key = encounterStatusKey(status);
  if (key === "pending") return <StatusIcon icon={Clock} label={t("pending")} variant="warning" />;
  if (key === "open") return <StatusIcon icon={CircleDot} label={t("open")} variant="muted" />;
  return null;
}

/**
 * The recorded result, only when it wants an admin: a dispute or a result
 * waiting for confirmation. Confirmed and "none" render nothing.
 */
export function ResultStatusPill({ status }: Readonly<{ status: string }>) {
  const t = useTranslations("adminMatches.encounters");
  if (status === "disputed") return <StatusPill tone="danger">{t("resultStatus.disputed")}</StatusPill>;
  if (status === "pending_confirmation") {
    return <StatusPill tone="warning">{t("resultStatus.pending_confirmation")}</StatusPill>;
  }
  return null;
}

/**
 * The planned start time, on the viewer's own clock (the app formatter's zone)
 * — the same zone the stage editor's round schedule is typed against. Its own
 * component so the column definitions stay independent of the formatter's
 * identity.
 */
export function ScheduledAtCell({ value }: Readonly<{ value: Encounter["scheduled_at"] }>) {
  const format = useFormatter();
  if (value == null) return null;
  const at = new Date(value);
  return (
    <time
      className="text-sm tabular-nums"
      dateTime={at.toISOString()}
      title={format.dateTime(at, { dateStyle: "full", timeStyle: "short" })}
    >
      {format.dateTime(at, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      })}
    </time>
  );
}
