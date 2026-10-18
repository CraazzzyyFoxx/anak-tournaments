import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { findRole, roleAncestors, rolePresentation, selectableRoles, ratedDimension, roleRefForWrite, selectionError, quotaCount } from "./ontology";
import { teamFormatPayload, teamFormatErrors } from "./team-format";
import type { RoleOntology } from "./ontology";

const dimension = (code: string, rated = false, selection_mode: "single" | "multi" = "single") => ({ id: code.length, code, name: code, rated, selection_mode, active: true, sort_order: 0 });
const role = (id: number, code: string, extra: Partial<RoleOntology["roles"][number]> = {}) => ({ id, code, dimension: "position", name: code, parent_id: null, workspace_id: null, active: true, selectable: true, sort_order: id, attrs: {}, ...extra });
const ontology: RoleOntology = {
  discipline: { code: "lol" }, workspace_id: 7,
  dimensions: [dimension("position", true), dimension("communication", false, "multi"), { ...dimension("retired"), active: false }],
  roles: [role(1, "top", { attrs: { icon: "/disciplines/lol/top.svg", color: "#123456" } }), role(2, "jungle"), role(3, "mid"), role(4, "bottom"), role(5, "support"), role(6, "support_child", { parent_id: 5, workspace_id: 7 }), role(7, "support_child", { parent_id: 5, workspace_id: 8 }), role(8, "support", { dimension: "communication" }), role(9, "old", { active: false }), role(10, "blocked", { selectable: false }), role(11, "retired", { dimension: "retired" })]
};

describe("scoped role ontology", () => {
  it("offers all five native positions plus only this workspace's selectable children", () => {
    expect(selectableRoles(ontology, "position").map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(selectableRoles(ontology, "retired")).toEqual([]);
    expect(findRole(ontology, { dimension: "position", role: "support_child" })?.id).toBe(6);
    expect(findRole({ ...ontology, workspace_id: 8 }, { dimension: "position", role: "support_child" })?.id).toBe(7);
    expect(findRole(ontology, { dimension: "communication", role: "support" })?.id).toBe(8);
  });
  it("reads OW roots and workspace children without borrowing identically named LoL presentation", () => {
    const ow: RoleOntology = { ...ontology, discipline: { code: "overwatch" }, dimensions: [dimension("player_role", true)], roles: [
      role(20, "tank", { dimension: "player_role" }), role(21, "damage", { dimension: "player_role" }),
      role(22, "support", { dimension: "player_role", attrs: { color: "#10b981", icon: "/disciplines/overwatch/roles/support.svg" } }),
      role(23, "support_main", { dimension: "player_role", parent_id: 22, workspace_id: 7, attrs: { color: null } })
    ] };
    expect(selectableRoles(ow, "player_role").map(row => row.code)).toEqual(["tank", "damage", "support", "support_main"]);
    expect(rolePresentation(ow.roles, 23)).toEqual({ icon: "/disciplines/overwatch/roles/support.svg", color: null });
    expect(rolePresentation(ontology.roles, 5)).toEqual({ icon: null, color: null });
  });
  it("retains inactive history, never selects unknown/retired refs, and requires exactly one active rated dimension", () => {
    expect(findRole(ontology, { dimension: "position", role: "old" })?.active).toBe(false);
    expect(selectionError(ontology, "position", [{ dimension: "position", role: "old" }])).toBe("role_unavailable");
    expect(selectionError(ontology, "position", [{ dimension: "position", role: "missing" }])).toBe("role_unavailable");
    expect(ratedDimension(ontology)?.code).toBe("position");
    expect(ratedDimension({ ...ontology, dimensions: [] })).toBeNull();
    expect(ratedDimension({ ...ontology, dimensions: ontology.dimensions.map(d => ({ ...d, rated: true })) })).toBeNull();
  });
  it("inherits each presentation key independently; explicit null clears and cycles terminate", () => {
    const roles = [role(1, "root", { attrs: { icon: "/disciplines/lol/root.svg", color: "#123456" } }), role(2, "child", { parent_id: 1, attrs: { color: "#abcdef" } }), role(3, "leaf", { parent_id: 2, attrs: { icon: null } })];
    expect(rolePresentation(roles, 2)).toEqual({ icon: "/disciplines/lol/root.svg", color: "#abcdef" });
    expect(rolePresentation(roles, 3)).toEqual({ icon: null, color: "#abcdef" });
    expect(rolePresentation([role(1, "cycle", { parent_id: 1 })], 1)).toEqual({ icon: null, color: null });
    expect(roleAncestors({ ...ontology, roles }, roles[2]).map(r => r.code)).toEqual(["child", "root"]);
    expect(roleRefForWrite({ dimension: "position", role: "support_child", parent: "support" })).toEqual({ dimension: "position", role: "support_child" });
  });
  it("honors single/multi dimensions and counts each starter once under descendant quotas", () => {
    const refs = [{ dimension: "position", role: "support" }, { dimension: "position", role: "support_child" }];
    expect(selectionError(ontology, "position", refs)).toBe("single_selection");
    expect(selectionError(ontology, "communication", [{ dimension: "communication", role: "support" }])).toBeNull();
    expect(quotaCount(ontology, [refs, [refs[1]], []], refs[0], true)).toBe(2);
    expect(quotaCount(ontology, [refs, [refs[1]], []], refs[0], false)).toBe(1);
  });
  it("renders white artwork with a color mask and unknown/retired history neutrally", () => {
    const render = (ref: { dimension: string; role: string }) => renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={{ common: { roleOntology: { unknown: "Unknown role: {role}", retired: "Retired role: {role}" }, roles: { flex: "Open slot" } } }}><PlayerRoleIcon role={ref} ontology={ontology} /></NextIntlClientProvider>);
    expect(render({ dimension: "position", role: "top" })).toContain("mask-image");
    expect(render({ dimension: "position", role: "top" })).toContain("#123456");
    expect(render({ dimension: "position", role: "missing" })).toContain("Unknown role: missing");
    expect(render({ dimension: "position", role: "old" })).toContain("Retired role: old");
  });
});

describe("native format transport", () => {
  const format = { name: "Native", preset_code: null, starter_min: 4, starter_max: 5, substitute_min: 0, substitute_max: 2, dimensions: [{ dimension: "position", mode: "enforced" as const, player_min_assignments: 0, player_max_assignments: null }, { dimension: "communication", mode: "informational" as const }], rules: [{ role: { dimension: "position", role: "support_child", parent: "support" }, hard_min: 0, hard_max: null, recommended_max: 2, include_descendants: false }] };
  it("keeps ranges, absent vs zero/null quotas and all dimensions, stripping only read-derived parent", () => {
    expect(teamFormatPayload(format)).toEqual({ ...format, rules: [{ ...format.rules[0], role: { dimension: "position", role: "support_child" } }] });
    expect(teamFormatPayload(format).rules[0]).not.toHaveProperty("recommended_min");
    expect(teamFormatErrors(format, ontology)).toEqual([]);
  });
  it("rejects stale scope refs and invalid metadata rather than rewriting into exact slots", () => {
    expect(teamFormatErrors({ ...format, rules: [{ role: { dimension: "position", role: "foreign" } }] }, ontology)).toContain("role_unavailable");
    expect(teamFormatErrors(format, { ...ontology, dimensions: [] })).toContain("rated_dimension");
    expect(teamFormatErrors({ ...format, starter_min: 6 }, ontology)).toContain("sizes");
  });
});
