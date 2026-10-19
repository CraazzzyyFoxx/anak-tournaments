import type { PlayerSubRole } from "@/types/admin.types";
import type { DisciplineMetadata, OntologyRole, RoleDimension } from "@/types/discipline.types";
import { OPEN_SLOT_CODE } from "./shape";
import type { RoleRef } from "./team-format";

/** One concrete game's history dictionary in one authorized workspace/global scope. */
export type OntologyDimension = Omit<RoleDimension, "selection_mode"> & { selection_mode: "single" | "multi" };
export type RoleOntology = Pick<DisciplineMetadata, "workspace_id" | "roles"> & {
  discipline: Pick<DisciplineMetadata["discipline"], "code">;
  dimensions: readonly OntologyDimension[];
};

export function ratedDimension(ontology: RoleOntology): OntologyDimension | null {
  const rated = ontology.dimensions.filter(dimension => dimension.active && dimension.rated);
  return rated.length === 1 ? rated[0] : null;
}

export function findRole(ontology: RoleOntology, ref: RoleRef | null | undefined): OntologyRole | null {
  if (!ref) return null;
  return ontology.roles.find(role => role.dimension === ref.dimension && role.code === ref.role &&
    (role.workspace_id === null || role.workspace_id === ontology.workspace_id)) ?? null;
}

/** Rendering admits history; writes admit only active/selectable rows of active dimensions. */
export function selectableRoles(ontology: RoleOntology, dimension: string): OntologyRole[] {
  if (!ontology.dimensions.some(row => row.code === dimension && row.active)) return [];
  return ontology.roles.filter(role => role.dimension === dimension && role.active && role.selectable &&
    (role.workspace_id === null || role.workspace_id === ontology.workspace_id))
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
}

/**
 * The roles a registrant may declare: the owner game's selectable, module-declared ROOT roles of its
 * rated dimension, in declared order (workspace children are specializations, never registration rows).
 * Empty for missing or invalid metadata, so nothing is ever synthesized.
 */
export function registrationRoles(ontology: RoleOntology | null | undefined): OntologyRole[] {
  const rated = ontology ? ratedDimension(ontology) : null;
  if (!ontology || !rated) return [];
  return selectableRoles(ontology, rated.code).filter(role => role.parent_id === null && role.workspace_id === null);
}

/**
 * What a roster editor's role picker offers: the game's selectable roles, the open slot last. A stored role the
 * game's catalog no longer offers (retired, unknown) keeps an option, or the trigger would render empty.
 */
export function roleChoices(ontology: RoleOntology | null | undefined, current: string): string[] {
  const codes = registrationRoles(ontology).map((role) => role.code);
  return [...(current === OPEN_SLOT_CODE || codes.includes(current) ? codes : [...codes, current]), OPEN_SLOT_CODE];
}

/** Every slot code a roster of this game can show, history included, in declared order; the open slot is last. */
export function slotCodeOrder(ontology: RoleOntology | null | undefined): string[] {
  const rated = ontology ? ratedDimension(ontology) : null;
  const codes = !ontology || !rated ? [] : ontology.roles
    .filter(role => role.dimension === rated.code && role.parent_id === null && role.workspace_id === null)
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
    .map(role => role.code);
  return [...codes, OPEN_SLOT_CODE];
}

/** The presentation color of a rated-dimension role code (inherited from its ancestors), or `null` — never a guessed hue. */
export function roleColor(ontology: RoleOntology | null | undefined, code: string): string | null {
  const rated = ontology ? ratedDimension(ontology) : null;
  const role = ontology && rated ? findRole(ontology, { dimension: rated.code, role: code }) : null;
  return ontology && role ? rolePresentation(ontology.roles, role.id).color : null;
}

/** Position of a slot code in {@link slotCodeOrder}; unknown codes sort after every known one. */
export function slotRank(order: readonly string[], code: string | null | undefined): number {
  const index = order.indexOf(code ?? "");
  return index === -1 ? order.length : index;
}

/**
 * A roster's role order for ONE game: the position of a participation's role (its root, so a workspace child sits
 * with its parent) in the dictionary's declared `sort_order`. A role of another dimension or game, an unknown role,
 * an unassigned player and a missing dictionary all rank equally, after every declared role -- so nothing is
 * ordered by a fixed vocabulary, and a League `support` never inherits an Overwatch `support`'s place.
 */
export function rosterRoleRank(ontology: RoleOntology | null | undefined): (role: RoleRef | null | undefined) => number {
  const rated = ontology ? ratedDimension(ontology) : null;
  const order = slotCodeOrder(ontology);
  return (role) => (rated && role && role.dimension === rated.code ? slotRank(order, role.parent ?? role.role) : order.length);
}

/** Maps a module-declared role code to its localized name, or `null` when the bundle has none. */
export type RoleNameLocalizer = (code: string) => string | null;

/**
 * A role's display name: the bundle's localized name for a module-declared role code (`common.roles.<code>`) when
 * it has one, else the ontology `name`, so a localized UI never falls back to the module's English name. Workspace
 * children carry their organizer's own wording and are never looked up.
 */
export function roleName(role: Pick<OntologyRole, "code" | "name" | "workspace_id">, localized?: RoleNameLocalizer): string {
  return (role.workspace_id === null ? localized?.(role.code) : null) ?? role.name;
}

/**
 * A slot's display name: the game's own role name (`nameOf`, localized when the bundle knows it), the caller's
 * open-slot label, or the raw code when this scope does not know the role (never a guessed one).
 */
export function slotLabel(
  ontology: RoleOntology | null | undefined,
  code: string,
  openLabel: string,
  nameOf: (role: OntologyRole) => string = (role) => role.name
): string {
  if (code === OPEN_SLOT_CODE) return openLabel;
  const rated = ontology ? ratedDimension(ontology) : null;
  const role = ontology && rated ? findRole(ontology, { dimension: rated.code, role: code }) : null;
  return role ? nameOf(role) : code;
}

/**
 * The sub-roles the workspace catalog offers under one role of the rated `dimension`, as `{ slug, label }` with the
 * LEAF code (`<role>_<slug>`, the spelling a participation's role reference stores). The open slot has no catalog.
 */
export function subRoleOptions(
  subRoles: readonly PlayerSubRole[] | undefined,
  dimension: string | undefined,
  role: string
): Array<{ slug: string; label: string }> {
  if (role === OPEN_SLOT_CODE) return [];
  return (subRoles ?? [])
    .filter((subRole) => subRole.role === role && subRole.dimension === dimension)
    .map((subRole) => ({ slug: `${role}_${subRole.slug}`, label: subRole.label }));
}

export function roleAncestors(ontology: RoleOntology, role: OntologyRole): OntologyRole[] {
  const ancestors: OntologyRole[] = [];
  const seen = new Set([role.id]);
  let parentId = role.parent_id;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = ontology.roles.find(row => row.id === parentId && row.dimension === role.dimension &&
      (row.workspace_id === null || row.workspace_id === ontology.workspace_id));
    if (!parent) break;
    ancestors.push(parent);
    seen.add(parent.id);
    parentId = parent.parent_id;
  }
  return ancestors;
}

/** Presence, not truthiness: explicit null stops inheritance independently for each key. */
export function rolePresentation(roles: readonly OntologyRole[], roleId: number): { icon: string | null; color: string | null } {
  const result: { icon: string | null; color: string | null } = { icon: null, color: null };
  const found = new Set<string>();
  const seen = new Set<number>();
  let current = roles.find(role => role.id === roleId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    for (const key of ["icon", "color"] as const) {
      if (found.has(key) || !Object.hasOwn(current.attrs, key)) continue;
      found.add(key);
      const value = current.attrs[key];
      result[key] = typeof value === "string" ? value : null;
    }
    const { parent_id, dimension } = current;
    current = roles.find(role => role.id === parent_id && role.dimension === dimension);
  }
  return result;
}

/** Writes never carry a read-derived parent, nor synthesize an assignment for an open slot. */
export function roleRefForWrite(ref: RoleRef): RoleRef {
  return { dimension: ref.dimension, role: ref.role };
}

export function selectionError(ontology: RoleOntology, dimension: string, refs: readonly RoleRef[]): string | null {
  if (!ratedDimension(ontology)) return "rated_dimension";
  const axis = ontology.dimensions.find(row => row.code === dimension && row.active);
  if (!axis) return "dimension_unavailable";
  const available = selectableRoles(ontology, dimension);
  if (refs.some(ref => ref.dimension !== dimension || !available.some(role => role.code === ref.role))) return "role_unavailable";
  if (new Set(refs.map(ref => ref.role)).size !== refs.length) return "duplicate_role";
  return axis.selection_mode === "single" && refs.length > 1 ? "single_selection" : null;
}

/** Distinct starters, not assignments; children count only when the native quota says so. */
export function quotaCount(ontology: RoleOntology, starters: readonly (readonly RoleRef[])[], ref: RoleRef, includeDescendants: boolean): number {
  const target = findRole(ontology, ref);
  if (!target) return 0;
  return starters.filter(assignments => assignments.some(assignment => {
    const role = findRole(ontology, assignment);
    return role?.id === target.id || (role !== null && includeDescendants && roleAncestors(ontology, role).some(parent => parent.id === target.id));
  })).length;
}

/** Local selections are scope-stamped: even identical codes cannot survive a game/workspace switch. */
export interface RoleSelection {
  discipline: string;
  workspace_id: number | null;
  refs: RoleRef[];
}

export function selectedRoleRefs(ontology: RoleOntology, selection: RoleSelection, dimension: string): RoleRef[] {
  if (selection.discipline !== ontology.discipline.code || selection.workspace_id !== ontology.workspace_id ||
      selectionError(ontology, dimension, selection.refs)) return [];
  return selection.refs.map(roleRefForWrite);
}
