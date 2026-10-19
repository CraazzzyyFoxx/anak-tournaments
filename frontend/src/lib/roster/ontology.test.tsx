import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { findRole, roleAncestors, rolePresentation, selectableRoles, ratedDimension, roleRefForWrite, selectionError, quotaCount, registrationRoles, roleChoices, roleName, slotCodeOrder, slotLabel, slotRank, subRoleOptions } from "./ontology";
import { teamFormatPayload, teamFormatErrors, teamFormatsEqual } from "./team-format";
import type { RoleOntology } from "./ontology";
import type { PlayerSubRole } from "@/types/admin.types";

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
    expect(render({ dimension: "position", role: "top" })).toContain('crossorigin="anonymous"');
    expect(render({ dimension: "position", role: "missing" })).toContain("Unknown role: missing");
    expect(render({ dimension: "position", role: "old" })).toContain("Retired role: old");
  });
});

describe("registration roles and slots", () => {
  it("offers a game's declared root roles only, never workspace children or other dimensions", () => {
    expect(registrationRoles(ontology).map(r => r.code)).toEqual(["top", "jungle", "mid", "bottom", "support"]);
    expect(registrationRoles(null)).toEqual([]);
    expect(registrationRoles({ ...ontology, dimensions: [] })).toEqual([]);
  });
  it("orders slots by the game's declaration with the open slot last, retired history included", () => {
    expect(slotCodeOrder(ontology)).toEqual(["top", "jungle", "mid", "bottom", "support", "old", "blocked", "flex"]);
    expect(slotRank(slotCodeOrder(ontology), "mid")).toBe(2);
    expect(slotRank(slotCodeOrder(ontology), "unheard-of")).toBe(slotCodeOrder(ontology).length);
    expect(slotCodeOrder(null)).toEqual(["flex"]);
  });
  it("names a slot by the game's role, the open slot by the caller's label, and an unknown role by its raw code", () => {
    expect(slotLabel({ ...ontology, roles: ontology.roles.map(r => r.code === "jungle" ? { ...r, name: "Jungle" } : r) }, "jungle", "Open")).toBe("Jungle");
    expect(slotLabel(ontology, "flex", "Open")).toBe("Open");
    expect(slotLabel(ontology, "tank", "Open")).toBe("tank");
    expect(slotLabel(null, "top", "Open")).toBe("top");
  });
  it("shows the bundle's localized name for a module-declared role and the ontology name otherwise", () => {
    const ru = (code: string) => (code === "support" ? "Саппорт" : null);
    const declared = { code: "support", name: "Support", workspace_id: null };
    expect(roleName(declared, ru)).toBe("Саппорт");
    // No message for the code: the module's own name, never a guess.
    expect(roleName({ code: "top", name: "Top", workspace_id: null }, ru)).toBe("Top");
    // A workspace child keeps its organizer's wording even when its code collides with a message key.
    expect(roleName({ code: "support", name: "Backline", workspace_id: 7 }, ru)).toBe("Backline");
    expect(roleName(declared)).toBe("Support");
    expect(slotLabel(ontology, "support", "Open", (found) => roleName(found, ru))).toBe("Саппорт");
    expect(slotLabel(ontology, "flex", "Open", (found) => roleName(found, ru))).toBe("Open");
  });
  it("localizes the role glyph's accessible name from the bundle", () => {
    const render = (messages: object) => renderToStaticMarkup(<NextIntlClientProvider locale="ru" messages={messages}><PlayerRoleIcon role={{ dimension: "position", role: "support" }} ontology={ontology} /></NextIntlClientProvider>);
    expect(render({ common: { roles: { support: "Саппорт", flex: "Флекс" }, roleOntology: { unknown: "?", retired: "?" } } })).toContain('aria-label="Саппорт"');
    expect(render({ common: { roles: { flex: "Флекс" }, roleOntology: { unknown: "?", retired: "?" } } })).toContain('aria-label="support"');
  });
  it("offers a role picker the game's roles with the open slot last, keeping a stored retired role selectable", () => {
    const all = ["top", "jungle", "mid", "bottom", "support"];
    expect(roleChoices(ontology, "mid")).toEqual([...all, "flex"]);
    expect(roleChoices(ontology, "flex")).toEqual([...all, "flex"]);
    expect(roleChoices(ontology, "old")).toEqual([...all, "old", "flex"]);
    expect(roleChoices(null, "flex")).toEqual(["flex"]);
  });
  it("lists a role's sub-roles by leaf code, scoped to the rated dimension, none for the open slot", () => {
    const catalog = [
      { role: "support", dimension: "position", slug: "warden", label: "Warden" },
      { role: "support", dimension: "communication", slug: "caller", label: "Caller" },
      { role: "top", dimension: "position", slug: "split", label: "Split" }
    ] as PlayerSubRole[];
    expect(subRoleOptions(catalog, "position", "support")).toEqual([{ slug: "support_warden", label: "Warden" }]);
    expect(subRoleOptions(catalog, "position", "flex")).toEqual([]);
    expect(subRoleOptions(undefined, "position", "support")).toEqual([]);
  });
});

describe("native format transport", () => {
  const format = { name: "Native", preset_code: null, starter_min: 4, starter_max: 5, substitute_min: 0, substitute_max: 2, dimensions: [{ dimension: "position", mode: "enforced" as const, player_min_assignments: 0, player_max_assignments: null }, { dimension: "communication", mode: "informational" as const }], rules: [{ role: { dimension: "position", role: "support_child", parent: "support" }, hard_min: 0, hard_max: null, recommended_max: 2, include_descendants: false }] };
  it("keeps ranges, absent vs zero/null quotas and all dimensions, stripping only read-derived parent", () => {
    expect(teamFormatPayload(format)).toEqual({ ...format, rules: [{ ...format.rules[0], role: { dimension: "position", role: "support_child" } }] });
    expect(teamFormatPayload(format).rules[0]).not.toHaveProperty("recommended_min");
    expect(teamFormatErrors(format, ontology)).toEqual([]);
  });
  it("compares saved serializer defaults as clean without erasing explicit zeros or payload absence", () => {
    const draft = { ...format, dimensions: [{ dimension: "position", mode: "enforced" as const }], rules: [{ role: { dimension: "position", role: "support_child" } }] };
    const saved = { ...draft, dimensions: [{ ...draft.dimensions[0], player_min_assignments: null, player_max_assignments: null }], rules: [{ ...draft.rules[0], hard_min: null, hard_max: null, recommended_min: null, recommended_max: null, include_descendants: true }] };
    expect(teamFormatsEqual(draft, saved)).toBe(true);
    expect(teamFormatPayload(draft).rules[0]).not.toHaveProperty("hard_min");
    expect(teamFormatsEqual({ ...draft, rules: [{ ...draft.rules[0], hard_min: 0 }] }, saved)).toBe(false);
    expect(teamFormatsEqual({ ...draft, starter_max: 6 }, saved)).toBe(false);
  });
  it("rejects stale scope refs and invalid metadata rather than rewriting into exact slots", () => {
    expect(teamFormatErrors({ ...format, rules: [{ role: { dimension: "position", role: "foreign" } }] }, ontology)).toContain("role_unavailable");
    expect(teamFormatErrors(format, { ...ontology, dimensions: [] })).toContain("rated_dimension");
    expect(teamFormatErrors({ ...format, starter_min: 6 }, ontology)).toContain("sizes");
  });
});
