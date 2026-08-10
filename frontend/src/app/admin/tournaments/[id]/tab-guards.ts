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
  "pickBan",
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
    case "pickBan":
      return p.canUpdateEncounter;
    case "registration":
      return p.canTeamRead;
    case "draft":
      return p.teamFormation === "draft";
    default:
      return true;
  }
}

/**
 * Sub-tabs of the `matches` hub tab.
 *
 * `results` is the landing segment: `/matches` redirects to it, and anything
 * unknown or unpermitted bounces there too. `logs` used to be a top-level tab
 * and keeps a permanent redirect from its old path. `report-form` is the
 * per-tournament captain-report configuration and sits last because it
 * configures the other sections rather than reporting on them.
 */
export const MATCHES_SUB_TAB_KEYS = ["results", "reports", "maps", "logs", "report-form"] as const;

export type MatchesSubTab = (typeof MATCHES_SUB_TAB_KEYS)[number];

export const MATCHES_DEFAULT_SUB_TAB: MatchesSubTab = "results";

export function isMatchesSubTab(value: string): value is MatchesSubTab {
  return (MATCHES_SUB_TAB_KEYS as readonly string[]).includes(value);
}

/**
 * Reading a sub-tab needs `match.read`; the write actions inside each one gate
 * themselves. Kept as a predicate rather than inlined so the tab bar and the
 * route guard cannot drift — a hidden tab that is still reachable by URL is the
 * bug this shape prevents.
 */
export function allowedMatchesSubTab(tab: MatchesSubTab, p: { canReadMatch: boolean }): boolean {
  switch (tab) {
    case "results":
    case "reports":
    case "maps":
    case "logs":
    case "report-form":
      return p.canReadMatch;
    default:
      return false;
  }
}
