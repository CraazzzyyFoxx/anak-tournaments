// @vitest-environment happy-dom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import { TeamFormatEditor } from "./TeamFormatEditor";
import { RoleSelector } from "./RoleSelector";
import { selectedRoleRefs, type RoleOntology, type RoleSelection } from "@/lib/roster/ontology";
import type { TeamFormatWrite } from "@/lib/roster/team-format";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ontology: RoleOntology = { discipline: { code: "native" }, workspace_id: 7,
  dimensions: [{ id: 1, code: "position", name: "Position", active: true, rated: true, selection_mode: "single", sort_order: 0 }, { id: 2, code: "tags", name: "Tags", active: true, rated: false, selection_mode: "multi", sort_order: 1 }],
  roles: [{ id: 1, dimension: "position", code: "support", name: "Support", parent_id: null, workspace_id: null, active: true, selectable: true, sort_order: 0, attrs: {} }, { id: 2, dimension: "tags", code: "caller", name: "Caller", parent_id: null, workspace_id: null, active: true, selectable: true, sort_order: 0, attrs: {} }, { id: 3, dimension: "tags", code: "leader", name: "Leader", parent_id: null, workspace_id: null, active: true, selectable: true, sort_order: 1, attrs: {} }] };
const initial: TeamFormatWrite = { name: "Native", preset_code: null, starter_min: 3, starter_max: 5, substitute_max: 2, dimensions: [{ dimension: "position", mode: "preference", player_min_assignments: 0, player_max_assignments: null }, { dimension: "tags", mode: "informational" }], rules: [{ role: { dimension: "position", role: "support" }, hard_min: 0, hard_max: null, recommended_min: 1, include_descendants: false }] };
const withSubRole: RoleOntology = { ...ontology, roles: [...ontology.roles, { id: 4, dimension: "position", code: "enchanter", name: "Enchanter", parent_id: 1, workspace_id: 7, active: true, selectable: true, sort_order: 0, attrs: {} }] };
let root: Root;
let container: HTMLDivElement;
const seen: { latest: TeamFormatWrite } = { latest: initial };
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); });
async function mount(children: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>));
}
function Harness({ roles = ontology }: Readonly<{ roles?: RoleOntology }>) {
  const [value, setValue] = useState(initial);
  useEffect(() => { seen.latest = value; });
  return <TeamFormatEditor value={value} ontology={roles} presets={[]} onChange={setValue} />;
}
const labelled = (label: string) => [...container.querySelectorAll("input")].find(input => input.getAttribute("aria-label") === label);
async function change(label: string, value: string) {
  const input = labelled(label)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("native team-format editor", () => {
  it("edits one bound without collapsing ranges, optional substitutes, dimension modes or null/zero quotas", async () => {
    await mount(<Harness />);
    await change(en.common.roleOntology.starterMax, "6");
    expect(seen.latest).toEqual({ ...initial, starter_max: 6 });
    expect(seen.latest).not.toHaveProperty("substitute_min");
    expect(container.textContent).toContain("Tags");
  });
  it("makes zero distinct from an empty/null quota, preserves descendants and recommended quotas", async () => {
    await mount(<Harness roles={withSubRole} />);
    await change(`${en.common.roleOntology.hardMax}: Support`, "0");
    expect(seen.latest.rules[0]).toEqual({ ...initial.rules[0], hard_max: 0 });
    await change(`${en.common.roleOntology.hardMax}: Support`, "");
    expect(seen.latest.rules[0].hard_max).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    await act(async () => toggle.click());
    expect(seen.latest.rules[0].include_descendants).toBe(true);
    expect(seen.latest.rules[0].recommended_min).toBe(1);
  });
  it("offers the sub-roles switch only where sub-roles exist and hides an Off dimension's quotas without dropping them", async () => {
    await mount(<Harness />);
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
    await act(async () => root.unmount()); container.remove();
    const off = { ...initial, dimensions: [{ dimension: "position", mode: "off" as const }] };
    await mount(<TeamFormatEditor value={off} ontology={ontology} presets={[]} onChange={() => { throw new Error("must not rewrite"); }} />);
    expect(labelled(`${en.common.roleOntology.hardMax}: Support`)).toBeUndefined();
    expect(labelled(en.common.roleOntology.starterMax)).toBeDefined();
  });
  it("shows invalid metadata instead of inventing a rated dimension", async () => {
    await mount(<TeamFormatEditor value={initial} ontology={{ ...ontology, dimensions: [] }} presets={[]} onChange={() => { throw new Error("must not rewrite"); }} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(en.common.roleOntology.metadataError);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });
  it("falls back to role initials when ontology artwork cannot load", async () => {
    const withIcon = { ...ontology, roles: [{ ...ontology.roles[0], attrs: { icon: "/disciplines/native/missing.svg" } }] };
    await mount(<PlayerRoleIcon role={{ dimension: "position", role: "support" }} ontology={withIcon} />);
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.textContent).toBe("SU");
    expect(container.querySelector("img")).toBeNull();
  });
  it("uses radio/checkbox selection and prevents identical stale refs crossing owner scope", async () => {
    let selection: RoleSelection = { discipline: "native", workspace_id: 7, refs: [] };
    await mount(<RoleSelector ontology={ontology} dimension="tags" value={selection} onChange={next => { selection = next; }} />);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    await act(async () => container.querySelector<HTMLInputElement>("input")!.click());
    expect(selection.refs).toEqual([{ dimension: "tags", role: "caller" }]);
    expect(selectedRoleRefs({ ...ontology, workspace_id: 8 }, selection, "tags")).toEqual([]);
    expect(selectedRoleRefs({ ...ontology, discipline: { code: "other" } }, selection, "tags")).toEqual([]);
    await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><RoleSelector ontology={ontology} dimension="position" value={{ ...selection, refs: [] }} onChange={() => {}} /></NextIntlClientProvider>));
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(1);
  });
});
