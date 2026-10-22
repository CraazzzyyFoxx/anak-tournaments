import { describe, expect, it } from "vitest";

import { decodePlayerSlug, getPlayerSlug, sortTeamPlayers, splitHandle, type SortableRosterPlayer } from "@/lib/player";
import type { RoleOntology } from "@/lib/roster/ontology";
import { LOL_METADATA, OW_METADATA } from "@/test/discipline-metadata";

describe("player slug helpers", () => {
  it("decodes percent-encoded battle tags from route slugs", () => {
    expect(decodePlayerSlug("%D0%A5%D0%BB%D0%BE%D1%80%D0%BE%D1%84%D0%BE%D1%80%D0%BC-21713")).toBe(
      "Хлороформ#21713"
    );
  });

  it("round-trips plain battle tags", () => {
    expect(decodePlayerSlug(getPlayerSlug("CraazzzyyFox#2130"))).toBe("CraazzzyyFox#2130");
  });

  it("falls back gracefully on malformed percent-encoding", () => {
    expect(decodePlayerSlug("%E0%A4%A-21713")).toBe("%E0%A4%A#21713");
  });
});

describe("splitHandle", () => {
  it("splits the discriminator off a BattleTag", () => {
    expect(splitHandle("Fox#2130")).toEqual({ name: "Fox", suffix: "#2130" });
  });

  it("returns a handle without a tag whole", () => {
    expect(splitHandle("Fox")).toEqual({ name: "Fox", suffix: null });
  });

  it("splits at the last # so a name that contains one keeps it", () => {
    expect(splitHandle("A#B#2130")).toEqual({ name: "A#B", suffix: "#2130" });
  });

  it("returns an empty or tag-only handle whole", () => {
    expect(splitHandle("")).toEqual({ name: "", suffix: null });
    expect(splitHandle("#2130")).toEqual({ name: "#2130", suffix: null });
  });
});

describe("sortTeamPlayers", () => {
  const starter = (id: number, dimension: string, role: string | null, rank: number, extra: Partial<SortableRosterPlayer> = {}): SortableRosterPlayer => ({
    id,
    role: role === null ? null : { dimension, role },
    rank,
    is_substitution: false,
    related_player_id: null,
    ...extra
  });
  const order = (players: SortableRosterPlayer[], ontology: RoleOntology | null) =>
    sortTeamPlayers(players, ontology).map((player) => player.id);

  it("orders an Overwatch roster by the game's declared role order, then rank", () => {
    const roster = [
      starter(1, "player_role", "support", 3000),
      starter(2, "player_role", "damage", 3200),
      starter(3, "player_role", "tank", 2800),
      starter(4, "player_role", "damage", 3500)
    ];

    expect(order(roster, OW_METADATA)).toEqual([3, 4, 2, 1]);
  });

  it("orders a League roster by its own positions: support is a position, not an Overwatch role", () => {
    const roster = [
      starter(1, "position", "support", 2000),
      starter(2, "position", "top", 1800),
      starter(3, "position", "bot", 2400),
      starter(4, "position", "jungle", 2100),
      starter(5, "position", "mid", 2200)
    ];

    // Declared order top, jungle, mid, bot, support; nothing jumps ahead because its code exists in Overwatch.
    expect(order(roster, LOL_METADATA)).toEqual([2, 4, 5, 3, 1]);
  });

  it("keeps a substitute under the starter it covered and ranks a workspace child with its parent", () => {
    const child = { ...LOL_METADATA, workspace_id: 7, roles: [...LOL_METADATA.roles, { id: 90, dimension: "position", code: "mid_roamer", name: "Roamer", parent_id: 13, workspace_id: 7, active: true, selectable: true, sort_order: 90, attrs: {} }] };
    const roster = [
      starter(1, "position", "bot", 2400),
      starter(2, "position", "mid_roamer", 2200, { role: { dimension: "position", role: "mid_roamer", parent: "mid" } }),
      starter(3, "position", "mid", 2100, { is_substitution: true, related_player_id: 2 }),
      starter(4, "position", "top", 1800)
    ];

    expect(order(roster, child)).toEqual([4, 2, 3, 1]);
  });

  it("ranks by rating alone without a dictionary, and a foreign game's role never takes a declared one's place", () => {
    const roster = [
      starter(1, "player_role", "tank", 2000),
      starter(2, "player_role", "support", 3000),
      starter(3, "player_role", null, 2500)
    ];

    expect(order(roster, null)).toEqual([2, 3, 1]);
    // Overwatch roles under a League dictionary are all foreign: equal, so rating decides.
    expect(order(roster, LOL_METADATA)).toEqual([2, 3, 1]);
  });
});
