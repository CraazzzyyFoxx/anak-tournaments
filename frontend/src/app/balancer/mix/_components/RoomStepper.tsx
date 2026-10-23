"use client";

import { useTranslations } from "next-intl";

import { useLiveMinutes } from "@/app/balancer/mix/_hooks/useLiveMinutes";
import { CAPTION_CLASS } from "@/app/balancer/mix/pickup-chrome";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import type { MixLobbyState } from "@/services/custom-game.service";

/**
 * A lobby's stage (spec §5): where it is, and -- once its match or its draft has started -- for how long. There is no
 * automatic timeout, so the elapsed minutes are how a host notices a match nobody recorded. Pre-game shows only where a
 * match bans; the draft steps only where the lobby drafts.
 */
export function RoomStepper({
  state,
  startedAt,
  bans,
  draft,
}: Readonly<{ state: MixLobbyState; startedAt: string | null; bans: boolean; draft: boolean }>) {
  const t = useTranslations("mixes.room");
  const steps: readonly MixLobbyState[] = [
    "idle",
    ...(draft ? (["draft_setup", "draft_live"] as const) : []),
    "ready",
    ...(bans ? (["pregame"] as const) : []),
    "live",
  ];
  const current = steps.indexOf(state);
  const minutes = useLiveMinutes(state, startedAt);
  return (
    <ol aria-label={t("steps")} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-1.5 text-caption",
            index === current ? "font-semibold text-[color:var(--aqt-fg)]" : "text-[color:var(--aqt-fg-dim)]",
          )}
        >
          <StatusDot
            tone={index === current ? (step === "live" || step === "draft_live" ? "danger" : "accent") : "neutral"}
            pulse={index === current && (step === "live" || step === "draft_live")}
            className="size-2"
          />
          <span>{t(`state.${step}`)}</span>
          {index === current && minutes != null ? (
            <span className={CAPTION_CLASS}>{t("elapsed", { minutes })}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
