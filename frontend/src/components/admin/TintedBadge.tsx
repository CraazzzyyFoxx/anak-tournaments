import { Badge } from "@/components/ui/badge";
import { TONE_CLASS } from "./tone";

interface TintedBadgeProps {
  /** Machine value the badge represents; `null`/`undefined` renders `fallback`. */
  value: string | null | undefined;
  /** Tinted classes per value (e.g. `{ ok: TONE_CLASS.success }`); an
   *  unrecognised or missing value falls back to the neutral tone. */
  styles: Record<string, string>;
  /** Optional display wording per value; falls back to the raw value. */
  labels?: Record<string, string>;
  /** Text shown when `value` is null/undefined. */
  fallback: string;
}

/**
 * Generic tinted status/state badge shared by every admin collector (rank,
 * subscriptions, streams): each domain supplies its own status vocabulary as
 * data (`styles`/`labels`) instead of re-implementing the badge.
 */
export function TintedBadge({ value, styles, labels, fallback }: Readonly<TintedBadgeProps>) {
  return (
    <Badge variant="outline" className={styles[value ?? ""] ?? TONE_CLASS.neutral}>
      {value ? (labels?.[value] ?? value) : fallback}
    </Badge>
  );
}
