import { TintedBadge } from "@/components/admin/TintedBadge";
import { TONE_CLASS } from "@/components/admin/tone";

export { formatDate, formatRelative } from "@/components/admin/format-time";

/** Tinted badge classes (border + tint + text) per status. */
const STATUS_STYLES: Record<string, string> = {
  ok: TONE_CLASS.success,
  private: TONE_CLASS.warning,
  not_found: TONE_CLASS.warning,
  error: TONE_CLASS.danger,
  rate_limited: TONE_CLASS.warning,
  disabled: TONE_CLASS.neutral,
  pending: TONE_CLASS.info
};

/**
 * Solid fill per status, for the stacked distribution bar. The three warning
 * statuses share one hue, so they are separated by alpha instead of by three
 * unrelated palette colours.
 */
export const STATUS_BAR: Record<string, string> = {
  ok: "bg-success",
  pending: "bg-info",
  not_found: "bg-warning",
  private: "bg-warning/70",
  error: "bg-danger",
  rate_limited: "bg-warning/40",
  disabled: "bg-muted-foreground/40"
};

/** Canonical display order for statuses. */
export const STATUS_ORDER = [
  "ok",
  "pending",
  "not_found",
  "private",
  "error",
  "rate_limited",
  "disabled"
] as const;

export function StatusBadge({ status }: Readonly<{ status: string | null }>) {
  return <TintedBadge value={status} styles={STATUS_STYLES} fallback="never" />;
}
