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
});
