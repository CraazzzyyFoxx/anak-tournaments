"use client";

import { cn } from "@/lib/utils";
import type { CustomGameOutcome } from "@/services/custom-game.service";

const BUTTON_TONE = "border-[color:var(--aqt-border)] bg-white/[0.015] text-[color:var(--aqt-fg-muted)]";

type PickupResultControlsProps = {
  /** How many teams the open balance produced — one win button each. */
  teamCount: number;
  /** Host overrides by position, falling back to `Team N` per button. */
  teamNames?: readonly string[];
  /** False once the mix is terminal or the viewer cannot write: shows the record read-only. */
  canRecord: boolean;
  saving: boolean;
  /** The host's configured rank-adjustment-per-win, shown on the win buttons; `null`/`0` hides it. */
  pointsPerWin?: number | null;
  size?: "sm" | "lg";
  onRecord: (outcome: CustomGameOutcome) => void;
};

/**
 * Recording who won one match of a mix — repeatable, does not close it.
 *
 * Shared by the mix screen and the fullscreen lobby board because a host calls
 * the scoreline out from the board and wants to log it without leaving. A
 * click adds the match to the permanent history straight away and the controls
 * go right back to their resting state -- there is nothing to stay "pressed",
 * so a host can call out and log several matches back to back without
 * resetting anything by hand. Once the host closes the mix (a separate action)
 * the controls render read-only instead of as three dead buttons.
 */
export function PickupResultControls({
  teamCount,
  teamNames,
  canRecord,
  saving,
  pointsPerWin,
  size = "sm",
  onRecord,
}: Readonly<PickupResultControlsProps>) {
  // A recorded match is always two-sided (`record_outcome` refuses anything
  // else, and the mix solver only ever produces two teams), so the winner is
  // exactly 1, 2 or a draw -- the same shape the server stores.
  const options: { key: string; label: string; winner: 1 | 2 | null }[] = Array.from(
    { length: Math.min(teamCount, 2) },
    (_, index) => ({
      key: `team-${index + 1}`,
      label: `${teamNames?.[index] ?? `Team ${index + 1}`} win`,
      winner: index === 0 ? 1 : 2,
    }),
  );
  // Draw sits between the two teams, mirroring the scoreline it describes.
  options.splice(1, 0, { key: "draw", label: "Draw", winner: null });

  return (
    <div className="flex items-center gap-1.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          disabled={!canRecord || saving}
          onClick={() => onRecord({ winner: option.winner })}
          className={cn(
            "flex items-center rounded-lg border font-semibold transition-colors",
            size === "lg" ? "h-[38px] px-4 text-caption" : "h-8 px-3 text-caption",
            BUTTON_TONE,
            canRecord && "hover:border-[color:var(--aqt-border-3)]",
            "disabled:cursor-default disabled:opacity-100",
          )}
        >
          {option.label}
          {/* A draw never adjusts ranks, so it never earns the hint. */}
          {pointsPerWin && option.winner != null ? (
            <span className="ml-1 text-[0.9em] opacity-70"> +{pointsPerWin}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
