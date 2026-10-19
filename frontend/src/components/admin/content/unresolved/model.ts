import type { DateFormatter } from "@/components/kit/format-time";
import type { CatalogAliasMissKind, CatalogAliasMissRead } from "@/types/admin.types";
import type { CatalogKind } from "@/types/catalog.types";

export const MISS_KINDS: CatalogAliasMissKind[] = ["character", "map", "mode", "stat", "event", "role"];

/**
 * Only a `character|map|mode` miss names a catalog entity an alias can be attached to — and its targets are that
 * miss's OWN discipline's rows of its kind. Stat, event and role misses name codes a game module declares: dismiss
 * is their only action, never an alias or a new definition.
 */
export function attachableKind(miss: CatalogAliasMissRead): CatalogKind | null {
  return miss.kind === "character" || miss.kind === "map" || miss.kind === "mode" ? miss.kind : null;
}

export function formatSeenAt(format: DateFormatter, value: string): string {
  return format.dateTime(new Date(value), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
