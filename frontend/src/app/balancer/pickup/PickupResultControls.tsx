"use client";

import { cn } from "@/lib/utils";
import type { CustomGameOutcome } from "@/services/custom-game.service";

const UNSELECTED_TONE =
  "border-[color:var(--aqt-border)] bg-white/[0.015] text-[color:var(--aqt-fg-muted)]";

const SELECTED_TONE = {
  first:
    "border-[color:color-mix(in_srgb,var(--aqt-teal)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-teal)_14%,transparent)] text-[color:var(--aqt-fg)]",
  other:
    "border-[color:color-mix(in_srgb,var(--aqt-amber)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--aqt-amber)_14%,transparent)] text-[color:var(--aqt-fg)]",
  draw: "border-[color:var(--aqt-border-3)] bg-white/[0.07] text-[color:var(--aqt-fg)]",
} as const;

function toneKey(winner: number | null): keyof typeof SELECTED_TONE {
  if (winner == null) return "draw";
  return winner === 1 ? "first" : "other";
}

type PickupResultControlsProps = {
  /** How many teams the open balance produced — one win button each. */
  teamCount: number;
  outcome: CustomGameOutcome | null;
  /** False once the mix is terminal or the viewer cannot write: shows the record read-only. */
  canRecord: boolean;
  saving: boolean;
  size?: "sm" | "lg";
  onRecord: (outcome: CustomGameOutcome) => void;
};

/**
 * Recording the result of a mix — the one control that closes it.
 *
 * Shared by the mix screen and the fullscreen lobby board because a host calls
 * the scoreline out from the board and wants to log it without leaving. The
 * selected option stays visibly selected after the write, so a read-only
 * terminal mix renders as its own recorded result rather than as three dead
 * buttons.
 */
export function PickupResultControls({
  teamCount,
  outcome,
  canRecord,
  saving,
  size = "sm",
  onRecord,
}: Readonly<PickupResultControlsProps>) {
  const options: { key: string; label: string; winner: number | null }[] = [
    ...Array.from({ length: teamCount }, (_, index) => ({
      key: `team-${index + 1}`,
      label: `Team ${index + 1} win`,
      winner: index + 1,
    })),
  ];
  // Draw sits between the two teams, mirroring the scoreline it describes.
  options.splice(1, 0, { key: "draw", label: "Draw", winner: null });

  return (
    <div className="flex items-center gap-1.5">
      {options.map((option) => {
        const selected = outcome != null && outcome.winner === option.winner;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={selected}
            disabled={!canRecord || saving}
            onClick={() => onRecord({ winner: option.winner })}
            className={cn(
              "flex items-center rounded-lg border font-semibold transition-colors",
              size === "lg" ? "h-[38px] px-4 text-[13px]" : "h-8 px-3 text-[12.5px]",
              // The selected pill borrows the winning team's accent, so the
              // record reads in the same colour language as the team column.
              selected ? SELECTED_TONE[toneKey(option.winner)] : UNSELECTED_TONE,
              canRecord && !selected && "hover:border-[color:var(--aqt-border-3)]",
              "disabled:cursor-default disabled:opacity-100",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
