"use client";

import { Ban, Check, CircleDashed, Flag, MapPin, Shield, Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PickBanEntry, PickBanKind, PickBanSession } from "@/types/tournament.types";

import { parseStepToken, roundState, stepRoundGroups, type PickBanSide } from "./pick-ban-model";
import type { PickBanItemLike } from "./PickBanGrid";
import { PickBanItemThumb } from "./PickBanItemThumb";

interface PickBanStepTimelineProps {
  kind: PickBanKind;
  sequence: string[];
  pool: PickBanEntry[];
  currentStepIndex: number | null;
  isComplete: boolean;
  /**
   * The server's `current_round`. Null for a flat pool, a completed sequence
   * and the unavailable state alike, so round mode is read off `pool[].round`
   * instead.
   */
  currentRound: number | null;
  itemsById: Record<number, PickBanItemLike | undefined>;
  sideName: (side: PickBanSide) => string;
  /** Drives the "who goes first" line under the Steps title -- moved here from the room header, next to the sequence it explains. */
  session: PickBanSession;
}

export function PickBanStepTimeline({
  kind,
  sequence,
  pool,
  currentStepIndex,
  isComplete,
  currentRound,
  itemsById,
  sideName,
  session
}: PickBanStepTimelineProps) {
  const t = useTranslations("pickBan.room");
  // Done-ness derives from committed pool actions, not from the step pointer:
  // every acted entry carries a global action_index (bans, picks, protects, decider).
  const actedCount = pool.reduce(
    (count, entry) => (entry.action_index != null ? count + 1 : count),
    0
  );
  // The grid groups by round whenever the pool carries rounds, and the two
  // stack in one viewport, so the timeline groups on exactly the same
  // condition — a flat timeline beside a grouped grid repeats "Decider" two to
  // five times with nothing to say which round each one closes.
  const stepGroups = stepRoundGroups(sequence, pool);

  const step = (index: number) => {
    const token = sequence[index];
    const parsed = parseStepToken(token);
    const done = isComplete || index < actedCount;
    const current = !done && currentStepIndex === index;
    const actedEntry = done ? pool.find((entry) => entry.action_index === index) : undefined;
    const actedItemName =
      actedEntry != null
        ? (itemsById[actedEntry.item_id]?.name ??
          t(`${kind}.itemNumber`, { id: actedEntry.item_id }))
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
          : parsed.action === "protect"
            ? t("steps.protect")
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
          done ? "opacity-70" : null
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
                : "text-[color:var(--aqt-fg-faint)]"
          )}
        />
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            parsed.action === "ban" ? "text-[color:var(--aqt-rose)]" : null,
            parsed.action === "pick" ? "text-[color:var(--aqt-support)]" : null,
            parsed.action === "protect" ? "text-[color:var(--aqt-amber)]" : null
          )}
        >
          {parsed.action === "ban" ? <Ban className="h-3.5 w-3.5" aria-hidden /> : null}
          {parsed.action === "protect" ? <Shield className="h-3.5 w-3.5" aria-hidden /> : null}
          {actionLabel}
        </span>
        {parsed.side ? (
          <span className="min-w-0 truncate text-[color:var(--aqt-fg-muted)]">
            {sideName(parsed.side)}
          </span>
        ) : null}
        {actedEntry != null && actedItemName != null ? (
          <span className="ml-auto flex min-w-0 items-center gap-1.5">
            <PickBanItemThumb
              kind={kind}
              item={itemsById[actedEntry.item_id]}
              name={actedItemName}
              size={22}
              muted={actedEntry.status === "banned"}
            />
            <span className="min-w-0 truncate font-medium">{actedItemName}</span>
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("steps.title")}</CardTitle>
        {session.first_side ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--aqt-fg-muted)]">
            <Flag className="h-4 w-4 text-[color:var(--aqt-teal)]" aria-hidden />
            <span>{t("firstBanner", { team: sideName(session.first_side) })}</span>
            <Badge variant="outline" className="font-normal text-[color:var(--aqt-fg-muted)]">
              {t(`seedSource.${session.seed_source}`)}
            </Badge>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {stepGroups === null
          ? sequence.map((_, index) => step(index))
          : stepGroups.map((group) => {
              const state = roundState(group, currentRound);
              // Below `lg` a Bo5 round-mode sequence is 15 steps sitting above
              // five item groups, so everything but the live round folds away
              // there. When no round is live — a completed sequence — there is
              // nothing to fold to, so the whole run stays visible.
              const folded = currentRound != null && state !== "current";
              return (
                <div
                  key={group.round}
                  data-pick-ban-step-round={group.round}
                  className={cn("flex-col gap-1.5", folded ? "hidden lg:flex" : "flex")}
                >
                  <div className="flex flex-wrap items-center gap-2 pt-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--aqt-fg-muted)]">
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
                  {group.stepIndices.map((index) => step(index))}
                </div>
              );
            })}
      </CardContent>
    </Card>
  );
}
