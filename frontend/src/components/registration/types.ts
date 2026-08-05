import type { RoleCode } from "@/lib/roles";

/**
 * How willing the registrant is to play a role.
 *
 * `main` is what the backend calls `is_primary`; a submission where every role
 * is `main` is what it derives as a flex registration
 * (`_is_flex_submission`, tournament-service `validation.py`).
 */
export type RolePriority = "off" | "fallback" | "main";

export interface RoleSelection {
  priority: RolePriority;
  subrole: string;
  /** Ordered hero slugs (top picks) for this role. */
  topHeroes: string[];
}

/**
 * One entry per role, always present.
 *
 * The wizard used to model roles as `primaryRole` + `additionalRoles[]` +
 * three separate hero lists, so choosing a role had to *reveal* the controls
 * that belonged to it. A fixed per-role map makes the role step a matrix whose
 * shape never changes with the selection.
 */
export type RoleSelections = Record<RoleCode, RoleSelection>;

export const EMPTY_ROLE_SELECTION: RoleSelection = {
  priority: "off",
  subrole: "",
  topHeroes: [],
};

/**
 * One entry per role, all `off` by default.
 *
 * `forced` is the tournament mode where role does not matter: every role starts
 * `main`, which is both the target state and a hard requirement — the wizard
 * only submits roles whose priority is not `off`, so an all-`off` start would
 * send no roles at all in a step that renders no priority control.
 */
export function createRoleSelections(forced = false): RoleSelections {
  const priority: RolePriority = forced ? "main" : "off";
  return {
    tank: { ...EMPTY_ROLE_SELECTION, priority },
    dps: { ...EMPTY_ROLE_SELECTION, priority },
    support: { ...EMPTY_ROLE_SELECTION, priority },
  };
}

/** A flex registration is every role marked `main` — mirrors the backend rule. */
export function isFlexSelection(selections: RoleSelections): boolean {
  const active = Object.values(selections).filter((entry) => entry.priority !== "off");
  return active.length > 1 && active.every((entry) => entry.priority === "main");
}
