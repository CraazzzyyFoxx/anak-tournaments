import { CheckCircle2, Clock3, Link2, Loader2, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type Tone } from "@/components/kit/tone";
import type { DateFormatter } from "@/components/kit/format-time";
import type { LogProcessingRecord, LogProcessingStatus } from "@/types/admin.types";
import { getRetryKind } from "../logs.helpers";

export type LogFilter = LogProcessingStatus;

export const STATUS_META: Record<LogProcessingStatus, { key: "queued" | "processing" | "awaitingLink" | "processed" | "failed"; icon: LucideIcon; tone: Tone }> = {
  pending: { key: "queued", icon: Clock3, tone: "neutral" },
  processing: { key: "processing", icon: Loader2, tone: "info" },
  awaiting_link: { key: "awaitingLink", icon: Link2, tone: "neutral" },
  done: { key: "processed", icon: CheckCircle2, tone: "success" },
  failed: { key: "failed", icon: XCircle, tone: "danger" }
};

/** Chip order is scan order: the states that need action come first. */
export const LOG_FILTERS: LogFilter[] = ["failed", "awaiting_link", "processing", "pending", "done"];

export const SOURCE_LABELS: Partial<Record<string, "sourceUpload" | "sourceDiscord" | "sourceManual" | "sourceHistoricalReference">> = {
  upload: "sourceUpload",
  discord: "sourceDiscord",
  manual: "sourceManual",
  historical_reference: "sourceHistoricalReference"
};

export function getRetryRefusal(record: LogProcessingRecord): "retryRawUnavailable" | "retryHistorical" | "retryUnbound" | null {
  if (!record.raw_available) return "retryRawUnavailable";
  if (record.source === "historical_reference") return "retryHistorical";
  if (record.status !== "awaiting_link" && record.attached_encounter_id != null && record.attached_encounter_game_id == null) {
    return "retryUnbound";
  }
  return null;
}

/**
 * Explicit bind: an awaiting or failed job whose stored document teams are known, with a verified raw source and
 * not a historical reference. Independent of the ordinary-retry refusals (`retryUnbound` reflects hints only).
 */
export function canBindExplicitly(record: LogProcessingRecord) {
  return (
    (record.status === "awaiting_link" || record.status === "failed") &&
    record.teams.length > 0 &&
    record.raw_available &&
    record.source !== "historical_reference"
  );
}

/** Done rows reparse (current evidence only); unfinished ones retry; nothing is offered while a source is refused. */
export function isRetryable(record: LogProcessingRecord) {
  return getRetryKind(record) != null && getRetryRefusal(record) == null;
}

export function formatDuration(record: LogProcessingRecord) {
  if (!record.started_at || !record.finished_at) {
    return record.status === "processing" ? "running" : "-";
  }

  const durationMs = new Date(record.finished_at).getTime() - new Date(record.started_at).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return "-";
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/** Matches `formatSyncTime` in ChallongeIntegrationSection so both admin logs read alike. */
export function formatLogTime(format: DateFormatter, value: string) {
  return format.dateTime(new Date(value), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** A structured error names its code; historical text (code `historical`) keeps the legacy status parse. */
export function getErrorSummary(record: LogProcessingRecord) {
  const structured = record.error && record.error.code !== "historical" ? record.error : null;
  const errorMessage = record.error_message;
  if (!structured && !errorMessage) return null;

  const codeMatch = errorMessage?.match(/['"]code['"]:\s*['"]([^'"]+)['"]/);
  const statusMatch = errorMessage?.match(/^(\d{3})/);
  const code = (structured?.code ?? codeMatch?.[1])?.replaceAll("_", " ");

  if (code) {
    const formattedCode = code.charAt(0).toUpperCase() + code.slice(1);
    return statusMatch ? `${statusMatch[1]} · ${formattedCode}` : formattedCode;
  }

  return errorMessage!.replace(/^(\d{3}:\s*)?/, "").slice(0, 120);
}

/** The message plus every issue path the validator reported. */
export function getErrorDetail(record: LogProcessingRecord) {
  const issues = record.error && record.error.code !== "historical" ? record.error.issues : [];
  return [record.error_message, ...issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)]
    .filter(Boolean)
    .join("\n");
}
