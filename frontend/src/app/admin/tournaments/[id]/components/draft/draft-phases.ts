import { useTranslations } from "next-intl";

import type { Phase } from "@/components/kit/PhaseStrip";
import type { DraftStatus } from "@/types/draft.types";

const PHASES = ["setup", "ready", "live", "done"] as const;

/**
 * Where the draft session stands, on the four-phase scale of F5/F6.
 *
 * One URL used to show either the setup wizard or the control room with no
 * indication of which, or of what comes next; this is that missing scale.
 *
 * `paused` is still Live (a paused draft is a running one waiting on the
 * organizer, not a phase of its own), and `cancelled` is back at Setup —
 * a cancelled session leaves the screen showing a fresh wizard, so claiming
 * any later phase would contradict what is on it.
 */
export function useDraftPhases(status: DraftStatus | null): Phase[] {
  const t = useTranslations("adminTournament.draftPhases");
  const current =
    status === "ready" ? 1 : status === "live" || status === "paused" ? 2 : status === "completed" ? 3 : 0;

  return PHASES.map((phase, index) => ({
    key: phase,
    label: t(phase),
    state: index < current ? "done" : index === current ? "current" : "todo"
  }));
}
