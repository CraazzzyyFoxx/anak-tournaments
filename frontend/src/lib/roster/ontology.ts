import type { DisciplineMetadata, OntologyRole, RoleDimension } from "@/types/discipline.types";
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
