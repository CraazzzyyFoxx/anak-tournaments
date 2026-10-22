"use client";

import { useTranslations } from "next-intl";

import { useLiveMinutes } from "@/app/balancer/mix/_hooks/useLiveMinutes";
import { CAPTION_CLASS } from "@/app/balancer/mix/pickup-chrome";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import type { MixLobbyState } from "@/services/custom-game.service";

/** The stages a lobby walks in П0; the draft and pre-game stages slot in between when they ship. */
const STEPS: readonly MixLobbyState[] = ["idle", "ready", "live"];

/**
 * A lobby's stage (spec §5): where it is, and -- while a match is live -- for how long. There is no automatic
 * timeout, so the elapsed minutes are how a host notices a match nobody recorded.
 */
export function RoomStepper({ state, startedAt }: Readonly<{ state: MixLobbyState; startedAt: string | null }>) {
  const t = useTranslations("mixes.room");
  const current = STEPS.indexOf(state);
  const minutes = useLiveMinutes(state, startedAt);
  return (
    <ol aria-label={t("steps")} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-1.5 text-caption",
            index === current ? "font-semibold text-[color:var(--aqt-fg)]" : "text-[color:var(--aqt-fg-dim)]",
          )}
        >
          <StatusDot
            tone={index === current ? (step === "live" ? "danger" : "accent") : "neutral"}
            pulse={index === current && step === "live"}
            className="size-2"
          />
          <span>{t(`state.${step}`)}</span>
          {step === "live" && minutes != null ? (
            <span className={CAPTION_CLASS}>{t("elapsed", { minutes })}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
