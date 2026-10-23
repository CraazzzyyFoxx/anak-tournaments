// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import type { RoleOntology } from "@/lib/roster/ontology";
import { LOL_METADATA, OW_METADATA } from "@/test/discipline-metadata";
import type { AdminRegistrationRole } from "@/types/balancer-admin.types";

import { RolesCell } from "./registrationColumnCells";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function declared(dimension: string, role: string, priority: number, rank: number): AdminRegistrationRole {
  return {
    role: { dimension, role },
    is_primary: priority === 0,
    priority,
    rank_value: rank,
    is_active: true,
    is_declared_active: true,
  } as AdminRegistrationRole;
}

async function mount(roles: AdminRegistrationRole[], ontology: RoleOntology | null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<RolesCell roles={roles} ontology={ontology} />);
  });
  return container;
}

const glyphNames = (scope: Element) =>
  [...scope.querySelectorAll("[role='img']")].map((node) => node.getAttribute("aria-label"));

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("RolesCell", () => {
  it("names an Overwatch registration's roles from the Overwatch dictionary", async () => {
    const scope = await mount([declared("player_role", "support", 0, 900), declared("player_role", "damage", 1, 700)], OW_METADATA);

    expect(glyphNames(scope)).toEqual(["Support", "Damage"]);
  });

  it("names a League registration's positions from the League dictionary", async () => {
    const scope = await mount([declared("position", "jungle", 0, 2400), declared("position", "mid", 1, 2200)], LOL_METADATA);

    expect(glyphNames(scope)).toEqual(["Jungle", "Mid"]);
    expect(scope.innerHTML).toContain("Jungle");
  });

  describe("the stored leaf", () => {
    // The workspace's own child of Damage, with its own name and art.
    const WITH_CHILD = {
      ...OW_METADATA,
      workspace_id: 3,
      roles: [
        ...OW_METADATA.roles,
        {
          id: 40,
          dimension: "player_role",
          code: "damage_hitscan",
          name: "Hitscan",
          parent_id: 2,
          workspace_id: 3,
          active: true,
          selectable: true,
          sort_order: 40,
          attrs: { icon: "/test-roles/hitscan.svg" },
        },
      ],
    } as RoleOntology;
    const leaf = (code: string, priority: number): AdminRegistrationRole =>
      ({
        ...declared("player_role", code, priority, 900),
        role: { dimension: "player_role", role: code, parent: "damage" },
      }) as AdminRegistrationRole;

    it("shows a workspace child with its own name and art, not its parent's", async () => {
      const scope = await mount([leaf("damage_hitscan", 0)], WITH_CHILD);

      expect(glyphNames(scope)).toEqual(["Hitscan"]);
      expect(scope.innerHTML).toContain("/test-roles/hitscan.svg");
      expect(scope.innerHTML).not.toContain("/test-roles/damage.svg");
    });

    it("keeps a leaf the dictionary does not know visibly unknown instead of showing its parent", async () => {
      const scope = await mount([leaf("damage_ghost", 0)], WITH_CHILD);

      expect(glyphNames(scope)).not.toContain("Damage");
      expect(scope.innerHTML).not.toContain("/test-roles/damage.svg");
      expect(scope.textContent).toContain("?");
    });
  });
});
