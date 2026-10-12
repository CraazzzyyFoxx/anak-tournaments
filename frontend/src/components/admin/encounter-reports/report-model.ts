import type { DateFormatter } from "@/components/kit/format-time";
import type { AdminCaptainReport } from "@/types/admin.types";

/** What an empty cell renders as, everywhere on this screen. */
export const DASH = "—";

/** What the captain last stood behind: an edited report supersedes its filing. */
export function submittedAt(report: AdminCaptainReport | null): string | null {
  return report ? (report.updated_at ?? report.created_at) : null;
}

export function fmtDate(format: DateFormatter, value: string | null | undefined): string {
  return value ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" }) : DASH;
}
