"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import HeroImage from "@/components/hero/HeroImage";
import type { PickBanEntry, PickBanEntryStatus, PickBanKind } from "@/types/tournament.types";

import { isEntrySelectable, pickedItemsInOrder, poolRoundGroups, roundState, statusLabelKey } from "./pick-ban-model";

/** Generic catalog entry the grid needs to render one item's tile — either a
 * `MapRead` or a `Hero`, reduced to the fields both shapes carry. */
export interface PickBanItemLike {
  name: string;
  image_path?: string | null;
  role?: string;
  type?: string;
}

interface PickBanGridProps {
  kind: PickBanKind;
  pool: PickBanEntry[];
  itemsById: Record<number, PickBanItemLike | undefined>;
  selectedItemId: number | null;
  /** Whether available items can currently be selected by this viewer. */
  canSelect: boolean;
  /**
   * The server's `current_round`. Null for a flat pool, for a completed
   * sequence and for the unavailable state — never read as a mode or
   * completion signal; round mode comes from `pool[].round` via `poolRoundGroups`.
   */
  currentRound: number | null;
  /**
   * Reserve item per round position, from the session's snapshot (map kind
   * only — always empty for hero). See `pickBanReserveMap`.
   */
  slotReserves: Map<number, number>;
  onSelect: (itemId: number) => void;
  /** Room-level header (back link, status, team matchup) merged into this card's top. */
  header: React.ReactNode;
}

const STATUS_BADGE_VARIANT: Record<PickBanEntryStatus, "secondary" | "destructive" | "default" | "outline"> = {
  available: "outline",
  banned: "destructive",
  picked: "default",
  protected: "secondary",
  played: "secondary",
};

/** Ties a locked round's tiles to the paragraph that explains why they are inert. */
const lockedHintId = (round: number) => `pick-ban-round-${round}-locked`;

export function PickBanGrid({
  kind,
  pool,
  itemsById,
  selectedItemId,
  canSelect,
  currentRound,
  slotReserves,
  onSelect,
  header,
}: PickBanGridProps) {
  const t = useTranslations("pickBan.room");
  const orderedPicks = pickedItemsInOrder(pool);
  const roundGroups = poolRoundGroups(pool);
  const itemName = (itemId: number) => itemsById[itemId]?.name ?? t(`${kind}.itemNumber`, { id: itemId });

  const currentRoundRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Below `lg` the timeline stacks above the grid, so a Bo5 round-mode
    // sequence leaves the live round well under the fold — and it moves as
    // rounds resolve. Ref attached only to the "current" group, so a finished
    // sequence (also `currentRound: null`) leaves this a no-op instead of
    // yanking the reader away from the final order.
    currentRoundRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentRound]);

  /** `lockedRound` is the group's round when that round has not opened yet, else null. */
  const tile = (entry: PickBanEntry, lockedRound: number | null) => {
    const item = itemsById[entry.item_id];
    const selectable = isEntrySelectable(entry, { canSelect, currentRound });
    const selected = selectedItemId === entry.item_id;
    const dimmed = entry.status === "banned";
    const initials = itemName(entry.item_id)
      .split(/\s+/)
      .map((word) => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    return (
      <button
        key={entry.id}
        type="button"
        disabled={!selectable}
        aria-pressed={selected}
        title={lockedRound != null ? t("round.locked", { n: lockedRound }) : undefined}
        aria-describedby={lockedRound != null ? lockedHintId(lockedRound) : undefined}
        onClick={() => onSelect(entry.item_id)}
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-xl border text-left outline-none transition-shadow",
          selected
            ? "border-[color:var(--aqt-teal)] ring-2 ring-[color:var(--aqt-teal)]/45"
            : "border-[color:var(--aqt-border)]",
          selectable
            ? "cursor-pointer hover:border-[color:var(--aqt-teal)]/60 focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
            : "cursor-default",
          lockedRound != null ? "border-dashed opacity-55" : null,
        )}
      >
        <div className={cn("relative w-full bg-[color:var(--aqt-card-2)]", kind === "hero" ? "h-14 sm:h-16" : "h-20 sm:h-24")}>
          {kind === "hero" ? (
            <div className="absolute inset-0 grid place-items-center">
              <HeroImage
                hero={{ name: itemName(entry.item_id), image_path: item?.image_path ?? "", role: item?.role ?? "" }}
                size={44}
                className={cn(
                  "transition-opacity",
                  dimmed ? "opacity-30 grayscale" : null,
                  entry.status === "played" ? "opacity-60" : null,
                  lockedRound != null ? "opacity-45 saturate-50" : null,
                )}
              />
            </div>
          ) : item?.image_path ? (
            <Image
              src={item.image_path}
              alt={item.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw"
              className={cn(
                "object-cover transition-opacity",
                dimmed ? "opacity-30 grayscale" : null,
                entry.status === "played" ? "opacity-60" : null,
                lockedRound != null ? "opacity-45 saturate-50" : null,
              )}
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center font-onest text-lg font-semibold text-[color:var(--aqt-fg-faint)]">
              {initials}
            </span>
          )}
          {entry.action_index != null ? (
            <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-black/65 font-mono text-xs font-semibold tabular-nums text-[color:var(--aqt-fg)]">
              {entry.action_index + 1}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5 p-2.5">
          <span className={cn("truncate text-sm font-medium", dimmed ? "line-through opacity-70" : null)}>
            {itemName(entry.item_id)}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={STATUS_BADGE_VARIANT[entry.status]} className="px-1.5 py-0 text-[10px]">
              {t(statusLabelKey(entry))}
            </Badge>
            {entry.picked_by ? (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-[color:var(--aqt-fg-muted)]">
                {t(`by.${entry.picked_by}`)}
              </Badge>
            ) : null}
            {entry.protected_by ? (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-[color:var(--aqt-fg-muted)]">
                {t(`protectedBy.${entry.protected_by}`)}
              </Badge>
            ) : null}
          </span>
        </div>
      </button>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 pb-3">
        {header}
        <div className="flex flex-row items-center justify-between gap-2 border-t border-[color:var(--aqt-border)] pt-4">
          <CardTitle className="text-base">{t(`${kind}.title`)}</CardTitle>
          {roundGroups ? (
            <Badge variant="outline" className="font-normal text-[color:var(--aqt-fg-muted)]">
              {t("round.inPlayCount", { count: roundGroups.length })}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {roundGroups === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {pool.map((entry) => tile(entry, null))}
          </div>
        ) : (
          roundGroups.map((group) => {
            const state = roundState(group, currentRound);
            const locked = state === "upcoming";
            // Absent, not null, for a round that named no reserve — so this is
            // undefined for most rounds and the caption is skipped entirely
            // rather than rendered with nothing after it.
            const reserveItemId = slotReserves.get(group.round);
            return (
              <div
                key={group.round}
                data-pick-ban-round={group.round}
                ref={state === "current" ? currentRoundRef : undefined}
                aria-current={state === "current" ? "step" : undefined}
                className="flex flex-col gap-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{t("round.label", { n: group.round })}</span>
                  <Badge
                    variant={state === "current" ? "default" : "outline"}
                    className="px-1.5 py-0 text-[10px] font-normal"
                  >
                    {state === "current"
                      ? t("round.current")
                      : state === "resolved"
                        ? t("round.resolved")
                        : t("round.upcoming")}
                  </Badge>
                </div>
                {locked ? (
                  <p id={lockedHintId(group.round)} className="text-xs text-[color:var(--aqt-fg-muted)]">
                    {t("round.locked", { n: group.round })}
                  </p>
                ) : null}
                {reserveItemId != null ? (
                  <p className="text-xs text-[color:var(--aqt-fg-muted)]">
                    {t("round.reserve", { item: itemName(reserveItemId) })}
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {group.entries.map((entry) => tile(entry, locked ? group.round : null))}
                </div>
              </div>
            );
          })
        )}

        {orderedPicks.length > 0 ? (
          <div>
            <div className="mb-1.5 text-sm font-medium">{t("order.title")}</div>
            <div className="flex flex-wrap gap-2">
              {orderedPicks.map((entry, index) => (
                <Badge key={entry.id} variant="secondary">
                  {index + 1}. {itemName(entry.item_id)}
                  {entry.picked_by === "decider" && entry.round == null ? ` · ${t("by.decider")}` : ""}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
