import type { DateFormatter } from "@/components/kit/format-time";
import type { AdminCaptainReport } from "@/types/admin.types";
import type { ReplayCode } from "@/types/encounter.types";

/** What an empty cell renders as, everywhere on this screen. */
export const DASH = "—";

/** One participation's replay codes in play order: `M1 A1B2, M2 B2C3`. Empty when it entered none. */
export function replayCodesText(codes: readonly ReplayCode[]): string {
  return [...codes]
    .sort((a, b) => a.position - b.position)
    .map((entry) => `M${entry.position} ${entry.code}`)
    .join(", ");
}

/** What the captain last stood behind: an edited report supersedes its filing. */
export function submittedAt(report: AdminCaptainReport | null): string | null {
  return report ? (report.updated_at ?? report.created_at) : null;
}

export function fmtDate(format: DateFormatter, value: string | null | undefined): string {
  return value ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" }) : DASH;
}
