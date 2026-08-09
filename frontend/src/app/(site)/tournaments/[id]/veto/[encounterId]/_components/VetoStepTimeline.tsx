"use client";

import { Ban, Check, CircleDashed, MapPin, Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MapRead } from "@/types/map.types";
import type { EncounterMapPoolEntry } from "@/types/tournament.types";

import { parseStepToken, slotState, stepSlotGroups, type VetoSide } from "./veto-model";

interface VetoStepTimelineProps {
  sequence: string[];
  pool: EncounterMapPoolEntry[];
  currentStepIndex: number | null;
  isComplete: boolean;
  /**
   * The server's `current_slot`. Null for a flat pool, a completed slot veto and
   * the unavailable state alike, so slot mode is read off `pool[].slot` instead.
   */
  currentSlot: number | null;
  mapsById: Record<number, MapRead | undefined>;
  sideName: (side: VetoSide) => string;
}

export function VetoStepTimeline({
  sequence,
  pool,
  currentStepIndex,
  isComplete,
  currentSlot,
  mapsById,
  sideName,
}: VetoStepTimelineProps) {
  const t = useTranslations("encounters.veto.room");
  // Done-ness derives from committed pool actions, not from the step pointer:
  // every acted entry carries a global action_index (bans, picks, decider).
  const actedCount = pool.reduce(
    (count, entry) => (entry.action_index != null ? count + 1 : count),
    0,
  );
  // The grid groups by slot whenever the pool carries slots, and the two stack in
  // one viewport, so the timeline groups on exactly the same condition — a flat
  // timeline beside a grouped grid repeats "Decider" two to five times with
  // nothing to say which slot each one closes.
  const stepGroups = stepSlotGroups(sequence, pool);

  const step = (index: number) => {
    const token = sequence[index];
    const parsed = parseStepToken(token);
    const done = isComplete || index < actedCount;
    const current = !done && currentStepIndex === index;
    const actedEntry = done ? pool.find((entry) => entry.action_index === index) : undefined;
    const actedMapName =
      actedEntry != null
        ? mapsById[actedEntry.map_id]?.name ?? t("maps.mapNumber", { id: actedEntry.map_id })
        : null;

    const Icon = done
      ? Check
      : parsed.action === "decider"
        ? Shuffle
        : current
          ? MapPin
          : CircleDashed;
    const actionLabel =
      parsed.action === "decider"
        ? t("steps.decider")
        : parsed.action === "ban"
          ? t("steps.ban")
          : t("steps.pick");

    return (
      <div
        key={`${token}-${index}`}
        aria-current={current ? "step" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
          current
            ? "border-[color:var(--aqt-teal)]/45 bg-[color:var(--aqt-teal)]/10"
            : "border-[color:var(--aqt-border)]",
          done ? "opacity-70" : null,
        )}
      >
        <span className="w-5 shrink-0 text-right font-mono text-xs text-[color:var(--aqt-fg-faint)]">
          {index + 1}
        </span>
        <Icon
          aria-label={done ? t("steps.done") : current ? t("steps.current") : t("steps.pending")}
          className={cn(
            "h-4 w-4 shrink-0",
            done
              ? "text-[color:var(--aqt-support)]"
              : current
                ? "text-[color:var(--aqt-teal)]"
                : "text-[color:var(--aqt-fg-faint)]",
          )}
        />
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            parsed.action === "ban" ? "text-[color:var(--aqt-rose)]" : null,
            parsed.action === "pick" ? "text-[color:var(--aqt-support)]" : null,
          )}
        >
          {parsed.action === "ban" ? <Ban className="h-3.5 w-3.5" aria-hidden /> : null}
          {actionLabel}
        </span>
        {parsed.side ? (
          <span className="min-w-0 truncate text-[color:var(--aqt-fg-muted)]">
            {sideName(parsed.side)}
          </span>
        ) : null}
        {actedMapName ? (
          <span className="ml-auto min-w-0 truncate font-medium">{actedMapName}</span>
        ) : null}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("steps.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {stepGroups === null
          ? sequence.map((_, index) => step(index))
          : stepGroups.map((group) => {
              const state = slotState(group, currentSlot);
              // Below `lg` a Bo5 slot veto is 15 steps sitting above five map
              // groups, so everything but the live slot folds away there. When
              // no slot is live — a completed veto — there is nothing to fold to,
              // so the whole run stays visible.
              const folded = currentSlot != null && state !== "current";
              return (
                <div
                  key={group.slot}
                  data-veto-slot={group.slot}
                  className={cn("flex-col gap-1.5", folded ? "hidden lg:flex" : "flex")}
                >
                  <div className="flex flex-wrap items-center gap-2 pt-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--aqt-fg-muted)]">
                      {t("slot.label", { n: group.slot })}
                    </span>
                    <Badge
                      variant={state === "current" ? "default" : "outline"}
                      className="px-1.5 py-0 text-[10px] font-normal"
                    >
                      {state === "current"
                        ? t("slot.current")
                        : state === "resolved"
                          ? t("slot.resolved")
                          : t("slot.upcoming")}
                    </Badge>
                  </div>
                  {group.stepIndices.map((index) => step(index))}
                </div>
              );
            })}
      </CardContent>
    </Card>
  );
}
