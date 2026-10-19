"use client";

import { useTranslations } from "next-intl";

import { StatusDot } from "@/components/ui/status-dot";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { useSlotLabel } from "@/hooks/useSlotLabel";
import { roleColor, slotCodeOrder, slotRank } from "@/lib/roster/ontology";
import { cn } from "@/lib/utils";

import styles from "../../TournamentDetail.module.css";

export function StatTile({
  label,
  value,
  hint,
  accent
}: Readonly<{ label: string; value: string; hint?: string; accent?: string }>) {
  return (
    <div className={styles.figure}>
      <div className={cn(styles.figureLabel, "flex items-center gap-1.5")}>
        {accent ? <StatusDot style={{ color: accent }} /> : null}
        {label}
      </div>
      <div className={styles.figureValue}>
        {value}
        {hint ? <span className={styles.figureHint}>{hint}</span> : null}
      </div>
    </div>
  );
}

/**
 * Count + split by role, from the server's own aggregate.
 *
 * The one place this shape is rendered: the overview's registration card shows
 * it beside the latest sign-ups, and the participants page shows it INSTEAD of
 * the roster when the organizer hid the list — in which case it is the only
 * thing either page can say, because the server sends no rows at all.
 */
export function RegistrationSummary({
  workspaceId,
  discipline,
  total,
  roleCounts,
  maxParticipants
}: Readonly<{
  /** The owner tournament's workspace and game: roles are named and tinted in that game's own ontology. */
  workspaceId: number;
  discipline: string;
  total: number;
  roleCounts: Readonly<Record<string, number>>;
  /** Advisory capacity. Rendered as a `/ N` suffix; never compared against `total`. */
  maxParticipants?: number | null;
}>) {
  const t = useTranslations();
  const ontology = useDisciplineMetadata(workspaceId, discipline).data ?? null;
  const roleLabel = useSlotLabel(ontology);
  const order = slotCodeOrder(ontology);
  // Only roles somebody actually declared: tiles that read zero describe the component, not the
  // field. A bucket this game's ontology does not know keeps its own code and a neutral tint — it is
  // never folded into another role.
  const counts = roleCounts as Readonly<Record<string, number>>;
  const shares = Object.keys(counts)
    .filter((code) => counts[code] > 0)
    .sort((a, b) => slotRank(order, a) - slotRank(order, b));
  const shareTotal = shares.reduce((sum, code) => sum + counts[code], 0);
  const hasCapacity = maxParticipants != null && maxParticipants > 0;

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-4">
        <StatTile
          label={t("tournamentDetail.overview.registration.total")}
          value={String(total)}
          hint={hasCapacity ? `/ ${maxParticipants}` : undefined}
        />
        {shares.map((code) => (
          <StatTile
            key={code}
            label={roleLabel(code)}
            value={String(counts[code])}
            accent={roleColor(ontology, code) ?? undefined}
          />
        ))}
      </div>
      {shares.length > 1 && shareTotal > 0 ? (
        <div aria-hidden className="mt-3 flex h-1.5 gap-px overflow-hidden rounded-sm">
          {shares.map((code) => (
            <span
              key={code}
              style={{
                width: `${(counts[code] / shareTotal) * 100}%`,
                background: roleColor(ontology, code) ?? "var(--aqt-fg-dim)"
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
