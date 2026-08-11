"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Ban, Shield } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterChip, FilterChipGroup } from "@/components/ui/filter-chip";
import { cn } from "@/lib/utils";
import HeroImage from "@/components/hero/HeroImage";
import { normalizeRole, type AqtRoleKey } from "@/components/hero/heroRole";
import type { PickBanEntry, PickBanEntryStatus, PickBanKind } from "@/types/tournament.types";

import {
  isEntrySelectable,
  pickedItemsInOrder,
  poolRoundGroups,
  roundState,
  statusLabelKey,
  type PickBanAttributeLocks
} from "./pick-ban-model";
import { PickBanItemThumb } from "./PickBanItemThumb";

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
  /**
   * What the attribute-uniqueness rule forbids (disabled) and what it makes
   * moot (greyed only) for the side on the clock — see `attributeLocks`.
   */
  locks: PickBanAttributeLocks;
  onSelect: (itemId: number) => void;
  /** Room-level header (back link, status, team matchup) merged into this card's top. */
  header: React.ReactNode;
}

const STATUS_BADGE_VARIANT: Record<
  PickBanEntryStatus,
  "secondary" | "destructive" | "default" | "outline"
> = {
  available: "outline",
  banned: "destructive",
  picked: "default",
  protected: "secondary",
  played: "secondary"
};

/** Hero Pool role filter: display order and the `common.roles.*` label suffix per role. */
const ROLE_ORDER: AqtRoleKey[] = ["tank", "damage", "support"];
const ROLE_LABEL_SUFFIX: Record<AqtRoleKey, "tank" | "dps" | "support"> = {
  tank: "tank",
  damage: "dps",
  support: "support"
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
  locks,
  onSelect,
  header
}: PickBanGridProps) {
  const t = useTranslations("pickBan.room");
  const tCommon = useTranslations("common");
  const [roleFilter, setRoleFilter] = useState<AqtRoleKey | "all">("all");
  const orderedPicks = pickedItemsInOrder(pool);
  const roundGroups = poolRoundGroups(pool);
  const itemName = (itemId: number) =>
    itemsById[itemId]?.name ?? t(`${kind}.itemNumber`, { id: itemId });
  const roleOf = (itemId: number): AqtRoleKey | null =>
    normalizeRole(itemsById[itemId]?.type ?? itemsById[itemId]?.role);
  /**
   * How the uniqueness rule treats this tile: `blocked` is a click the server
   * would reject, `pointless` a legal one that achieves nothing. Only
   * `available` entries can be either — anything already taken is out of play
   * for its own reasons.
   */
  const lockOf = (entry: PickBanEntry): "blocked" | "pointless" | null => {
    if (entry.status !== "available") return null;
    const attribute = roleOf(entry.item_id);
    if (attribute == null) return null;
    if (locks.blocked.has(attribute)) return "blocked";
    if (locks.pointless.has(attribute)) return "pointless";
    return null;
  };

  const currentRoundRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Below `lg` the timeline stacks above the grid, so a Bo5 round-mode
    // sequence leaves the live round well under the fold — and it moves as
    // rounds resolve. Ref attached only to the "current" group, so a finished
    // sequence (also `currentRound: null`) leaves this a no-op instead of
    // yanking the reader away from the final order.
    currentRoundRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentRound]);

  // Role filter only applies to the Hero Pool -- maps have no role, and its
  // grid keeps rendering the full flat list/round groups unfiltered.
  const roleCounts =
    kind === "hero"
      ? pool.reduce<Record<AqtRoleKey, number>>(
          (counts, entry) => {
            const role = roleOf(entry.item_id);
            if (role) counts[role] += 1;
            return counts;
          },
          { tank: 0, damage: 0, support: 0 }
        )
      : null;
  const visibleEntries = (entries: PickBanEntry[]) =>
    kind === "hero" && roleFilter !== "all"
      ? entries.filter((entry) => roleOf(entry.item_id) === roleFilter)
      : entries;
  const poolLayoutClass =
    kind === "hero"
      ? "flex flex-wrap gap-2"
      : "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4";

  /** `lockedRound` is the group's round when that round has not opened yet, else null. */
  const tile = (entry: PickBanEntry, lockedRound: number | null) => {
    const item = itemsById[entry.item_id];
    const lock = lockOf(entry);
    const selectable = isEntrySelectable(entry, { canSelect, currentRound }) && lock !== "blocked";
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
        title={
          lockedRound != null
            ? t("round.locked", { n: lockedRound })
            : lock != null
              ? t(`rule.${lock}`)
              : undefined
        }
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
          lock != null ? "opacity-55 grayscale" : null
        )}
      >
        <div className="relative h-20 w-full bg-[color:var(--aqt-card-2)] sm:h-24">
          {item?.image_path ? (
            <Image
              src={item.image_path}
              alt={item.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw"
              className={cn(
                "object-cover transition-opacity",
                dimmed ? "opacity-30 grayscale" : null,
                entry.status === "played" ? "opacity-60" : null,
                lockedRound != null ? "opacity-45 saturate-50" : null
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
          <span
            className={cn(
              "truncate text-sm font-medium",
              dimmed ? "line-through opacity-70" : null
            )}
          >
            {itemName(entry.item_id)}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={STATUS_BADGE_VARIANT[entry.status]} className="px-1.5 py-0 text-[10px]">
              {t(statusLabelKey(entry))}
            </Badge>
            {entry.picked_by ? (
              <Badge
                variant="outline"
                className="px-1.5 py-0 text-[10px] font-normal text-[color:var(--aqt-fg-muted)]"
              >
                {t(`by.${entry.picked_by}`)}
              </Badge>
            ) : null}
            {entry.protected_by ? (
              <Badge
                variant="outline"
                className="px-1.5 py-0 text-[10px] font-normal text-[color:var(--aqt-fg-muted)]"
              >
                {t(`protectedBy.${entry.protected_by}`)}
              </Badge>
            ) : null}
          </span>
        </div>
      </button>
    );
  };

  /**
   * Icon-only Hero Pool tile: a bare round portrait, no name/status text on the
   * card. The hero name lives in `title`/`aria-label` instead of visible copy —
   * this tile optimizes for density, not for a status legend (the pick-order
   * list below still spells out who took what).
   *
   * A `protected` hero is NOT drawn as a taken one. It used to collapse into the
   * same crossed-out glyph every non-`available` status got, which read as
   * "banned" — the opposite of what a protect means: the hero is safe from the
   * opponent's ban and stays perfectly playable. It keeps its colour and wears
   * an amber shield instead, so the two never look alike.
   */
  const heroTile = (entry: PickBanEntry, lockedRound: number | null) => {
    const item = itemsById[entry.item_id];
    const lock = lockOf(entry);
    const selectable = isEntrySelectable(entry, { canSelect, currentRound }) && lock !== "blocked";
    const selected = selectedItemId === entry.item_id;
    const shielded = entry.status === "protected";
    // Out of play for the rest of the round, whoever took it and however.
    const taken = entry.status !== "available" && !shielded;
    const name = itemName(entry.item_id);
    // Only the RULE gets to replace the name in the tooltip: a not-yet-open
    // round already explains itself through `aria-describedby` and the visible
    // hint under the group, and the name is this tile's only label.
    const ruleReason = lock != null ? t(`rule.${lock}`) : null;

    return (
      <button
        key={entry.id}
        type="button"
        disabled={!selectable}
        aria-pressed={selected}
        aria-label={`${name} — ${t(statusLabelKey(entry))}${ruleReason != null ? ` — ${ruleReason}` : ""}`}
        title={ruleReason ?? name}
        aria-describedby={lockedRound != null ? lockedHintId(lockedRound) : undefined}
        onClick={() => onSelect(entry.item_id)}
        className={cn(
          "group relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border p-0.5 outline-none transition-shadow",
          selected
            ? "border-[color:var(--aqt-teal)] ring-2 ring-[color:var(--aqt-teal)]/45"
            : shielded
              ? "border-[color:var(--aqt-amber)]/70"
              : "border-[color:var(--aqt-border)]",
          selectable
            ? "cursor-pointer hover:border-[color:var(--aqt-teal)]/60 focus-visible:ring-2 focus-visible:ring-[color:var(--aqt-teal)]"
            : "cursor-default",
          lockedRound != null ? "border-dashed opacity-55" : null,
          lock != null ? "opacity-55 grayscale" : null
        )}
      >
        <HeroImage
          hero={{ name, image_path: item?.image_path ?? "", role: item?.role ?? "" }}
          size={38}
          className={cn(
            "transition-opacity",
            taken ? "opacity-40 grayscale" : null,
            lockedRound != null ? "opacity-45 saturate-50" : null
          )}
        />
        {taken ? (
          <span className="absolute inset-0 grid place-items-center" aria-hidden>
            <Ban className="h-[70%] w-[70%] text-[color:var(--aqt-rose)]" strokeWidth={1.25} />
          </span>
        ) : null}
        {shielded ? (
          // Corner badge, not an overlay: the portrait has to stay readable,
          // because this hero is still in the game.
          <span
            aria-hidden
            className="absolute -bottom-0.5 -left-0.5 grid h-4 w-4 place-items-center rounded-full bg-[color:var(--aqt-card)] ring-1 ring-[color:var(--aqt-amber)]/70"
          >
            <Shield className="h-2.5 w-2.5 text-[color:var(--aqt-amber)]" />
          </span>
        ) : null}
        {entry.action_index != null ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/70 font-mono text-[8px] font-semibold tabular-nums text-[color:var(--aqt-fg)]">
            {entry.action_index + 1}
          </span>
        ) : null}
      </button>
    );
  };
  const renderTile = kind === "hero" ? heroTile : tile;

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
        {roleCounts ? (
          <FilterChipGroup label={tCommon("filters")}>
            <FilterChip
              active={roleFilter === "all"}
              count={pool.length}
              onClick={() => setRoleFilter("all")}
            >
              {tCommon("all")}
            </FilterChip>
            {ROLE_ORDER.filter((role) => roleCounts[role] > 0).map((role) => (
              <FilterChip
                key={role}
                active={roleFilter === role}
                count={roleCounts[role]}
                onClick={() => setRoleFilter(role)}
              >
                {tCommon(`roles.${ROLE_LABEL_SUFFIX[role]}`)}
              </FilterChip>
            ))}
          </FilterChipGroup>
        ) : null}

        {roundGroups === null ? (
          <div className={poolLayoutClass}>
            {visibleEntries(pool).map((entry) => renderTile(entry, null))}
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
                  <span className="text-sm font-semibold">
                    {t("round.label", { n: group.round })}
                  </span>
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
                  <p
                    id={lockedHintId(group.round)}
                    className="text-xs text-[color:var(--aqt-fg-muted)]"
                  >
                    {t("round.locked", { n: group.round })}
                  </p>
                ) : null}
                {reserveItemId != null ? (
                  <p className="text-xs text-[color:var(--aqt-fg-muted)]">
                    {t("round.reserve", { item: itemName(reserveItemId) })}
                  </p>
                ) : null}
                <div className={poolLayoutClass}>
                  {visibleEntries(group.entries).map((entry) =>
                    renderTile(entry, locked ? group.round : null)
                  )}
                </div>
              </div>
            );
          })
        )}

        {orderedPicks.length > 0 ? (
          <div>
            <div className="mb-1.5 text-sm font-medium">{t("order.title")}</div>
            {/* The settled order as a rail of stills/portraits: the art is the
                token, the ordinal rides it as a corner chip, and the name is a
                caption under it rather than the only thing on screen. */}
            <ol className="flex flex-wrap gap-2">
              {orderedPicks.map((entry, index) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card-2)]/40 py-1.5 pl-1.5 pr-2.5"
                >
                  <span className="relative shrink-0">
                    <PickBanItemThumb
                      kind={kind}
                      item={itemsById[entry.item_id]}
                      name={itemName(entry.item_id)}
                      size={26}
                    />
                    <span
                      aria-hidden
                      className="absolute -left-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[color:var(--aqt-teal)] px-1 font-mono text-[9px] font-bold leading-none text-[color:var(--aqt-bg)]"
                    >
                      {index + 1}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="min-w-0 truncate text-xs font-medium">
                      {itemName(entry.item_id)}
                    </span>
                    {entry.picked_by === "decider" && entry.round == null ? (
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--aqt-fg-faint)]">
                        {t("by.decider")}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
