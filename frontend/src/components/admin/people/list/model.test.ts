import { describe, expect, it } from "vitest";

import type { AuthAdminUser } from "@/types/rbac.types";

import { accessAccountsHref, authAccountsByPlayerId } from "./model";

describe("people list model", () => {
  it("searches Access by the handle without its tag", () => {
    expect(accessAccountsHref("nnniik#2515")).toBe("/admin/access/accounts?q=nnniik");
    expect(accessAccountsHref("#2515")).toBe("/admin/access/accounts?q=%232515");
  });

  it("indexes every linked player to its account", () => {
    const account = {
      id: 90,
      linked_players: [
        { player_id: 11, player_name: "a", is_primary: true, linked_at: "2026-01-01" },
        { player_id: 12, player_name: "b", is_primary: false, linked_at: "2026-01-01" }
      ]
    } as AuthAdminUser;

    const index = authAccountsByPlayerId([account]);
    expect(index.get(11)).toBe(account);
    expect(index.get(12)).toBe(account);
    expect(index.has(13)).toBe(false);
  });
});
