/**
 * Route guards for the tournament hub tabs (D2, D20, D16).
 *
 * Pure predicate mirroring the conditional tab render of the pre-T5
 * useState-based hub page: tabs the caller may not open are hidden from the
 * tab bar and direct navigation is redirected to `overview` by the shell.
 */
export const TAB_KEYS = [
  "overview",
  "registration",
  "teams",
  "stages",
  "matches",
  "settings",
  "draft",
  "veto",
  "logs"
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export function isTabKey(value: string): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

export function allowedTab(
  tab: TabKey,
  p: {
    canUpdateTournament: boolean;
    canUpdateEncounter: boolean;
    canTeamRead: boolean;
    teamFormation: "balancer" | "draft";
  }
): boolean {
  switch (tab) {
    case "settings":
      return p.canUpdateTournament;
    case "veto":
      return p.canUpdateEncounter;
    case "registration":
      return p.canTeamRead;
    case "draft":
      return p.teamFormation === "draft";
    default:
      return true;
  }
}
