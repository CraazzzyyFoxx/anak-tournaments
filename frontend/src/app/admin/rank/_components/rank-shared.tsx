import { Badge } from "@/components/ui/badge";
import { TONE_CLASS } from "@/components/admin/tone";

/** Tinted badge classes (border + tint + text) per status. */
export const STATUS_STYLES: Record<string, string> = {
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

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/** Compact "5m ago" / "2h ago" style relative time; falls back to "—". */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function StatusBadge({ status }: { status: string | null }) {
  return (
    <Badge
      variant="outline"
      className={STATUS_STYLES[status ?? ""] ?? TONE_CLASS.neutral}
    >
      {status ?? "never"}
    </Badge>
  );
}
