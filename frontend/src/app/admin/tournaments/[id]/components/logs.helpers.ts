import { ApiError } from "@/lib/api/error";
import type { LogOperationErrorCode, LogProcessingRecord } from "@/types/admin.types";

export function getLogFileName(filename: string) {
  return filename.split(/[\\/]/).at(-1) ?? filename;
}

/** Codes the backend answers for a refused bind/reparse/retry; each has a `logsExtra.opError` message. */
export const LOG_OPERATION_ERROR_CODES: readonly LogOperationErrorCode[] = [
  "expected_revision_required",
  "stale_revision",
  "stale_binding",
  "binding_mismatch",
  "identity_conflict",
  "invalid_team_map",
  "binding_target_not_found",
  "ingest_busy",
  "ingest_pending",
  "reparse_required",
  "job_not_done"
];

/** The machine code of a refused operation, or null for anything else (network, 5xx, unknown codes). */
export function logOperationErrorCode(error: unknown): LogOperationErrorCode | null {
  if (!(error instanceof ApiError)) return null;
  const code = error.details.find((detail) =>
    (LOG_OPERATION_ERROR_CODES as readonly string[]).includes(detail.code)
  )?.code;
  return (code as LogOperationErrorCode | undefined) ?? null;
}

/**
 * What the row's retry control does: a done job is replaced only by an explicit reparse that carries the
 * revision this row showed, and only while it is still its game's current evidence.
 */
export function getRetryKind(record: LogProcessingRecord): "retry" | "reparse" | null {
  if (record.status === "processing") return null;
  if (record.status !== "done") return "retry";
  return record.is_current_provenance && record.observation_revision != null ? "reparse" : null;
}

/** Reparse request with the revision captured from the row; plain retries send no precondition. */
export function retryRequestFor(record: LogProcessingRecord) {
  return getRetryKind(record) === "reparse"
    ? { reparse: true, expected_revision: record.observation_revision! }
    : undefined;
}

/**
 * Revision of the observation a game currently has, from the encounter's log history: the newest
 * current-provenance job for that game. 0 = no observation is known. An observation without a job
 * (historical) is not listed, so the server's `stale_revision` is what refuses replacing it.
 */
export function gameObservationRevision(items: readonly LogProcessingRecord[], gameId: number): number {
  let revision = 0;
  for (const item of items) {
    if (item.is_current_provenance && item.attached_encounter_game_id === gameId) {
      revision = Math.max(revision, item.observation_revision ?? 0);
    }
  }
  return revision;
}
