import type { RegistrationTeamStatus } from "@/types/registration-team.types";

/**
 * One color recipe per registered-team lifecycle status, shared by every public
 * surface that shows it. `RegistrationTeamsList` (the tournament's full roster)
 * and `MyTeamPanel` (a captain's own team) used to keep separate copies — and
 * `MyTeamPanel`'s copy never existed, so the same "forming" status read as
 * amber on the roster and as a plain, uncolored pill on the captain's own card.
 */
export const REGISTRATION_TEAM_STATUS_TONE: Record<RegistrationTeamStatus, string> = {
  forming:
    "border-[color:var(--aqt-amber)]/40 bg-[color:var(--aqt-amber)]/10 text-[color:var(--aqt-amber)]",
  complete:
    "border-[color:var(--aqt-teal)]/40 bg-[color:var(--aqt-teal)]/10 text-[color:var(--aqt-teal)]",
  rejected:
    "border-[color:var(--aqt-rose)]/40 bg-[color:var(--aqt-rose)]/10 text-[color:var(--aqt-rose)]",
  disbanded:
    "border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] text-[color:var(--aqt-fg-dim)]"
};
