import type { CaptainReport } from "@/types/encounter.types";

/**
 * A standing as text, one score per seat in the order of `seatIds` (callers
 * pass slot order, so a duel reads slot 1 first): `2 – 1`. Takes the lines of a
 * report (`report.results`) or of an audit snapshot alike; a seat with no line
 * reads `–`.
 */
export function scoreline(
  lines: readonly { encounter_team_id: number; score: number | null }[],
  seatIds: readonly number[]
): string {
  return seatIds
    .map((id) => lines.find((line) => line.encounter_team_id === id)?.score ?? "–")
    .join(" – ");
}

/** The report a participation filed, or null while it has not. */
export function reportOf<T extends Pick<CaptainReport, "encounter_team_id">>(
  reports: readonly T[],
  encounterTeamId: number | null | undefined
): T | null {
  return reports.find((report) => report.encounter_team_id === encounterTeamId) ?? null;
}
