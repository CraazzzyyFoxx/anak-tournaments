import { describe, expect, it } from "vitest";

import {
  applyDragEvent,
  pruneStaleDrags,
  type DragEventData,
  type RemoteDrag,
} from "@/components/balancer/useBalancerDragGhosts";

const startData: DragEventData = {
  phase: "start",
  player_id: "7",
  player_name: "Echo",
  from_team_index: 0,
  from_role_key: "Damage",
};

const overData: DragEventData = {
  ...startData,
  phase: "over",
  over_team_index: 1,
  over_role_key: "Tank",
  over_insert_index: null,
};

describe("applyDragEvent", () => {
  it("ignores frames from the current user", () => {
    const result = applyDragEvent({}, 5, startData, 5, 1000);
    expect(result).toEqual({});
  });

  it("ignores frames with no actor", () => {
    const result = applyDragEvent({}, null, startData, 5, 1000);
    expect(result).toEqual({});
  });

  it("adds a ghost on start and updates it on over", () => {
    const afterStart = applyDragEvent({}, 9, startData, 5, 1000);
    expect(afterStart[9]?.playerName).toBe("Echo");
    expect(afterStart[9]?.overTeamIndex).toBe(null);

    const afterOver = applyDragEvent(afterStart, 9, overData, 5, 1100);
    expect(afterOver[9]?.overTeamIndex).toBe(1);
    expect(afterOver[9]?.overRoleKey).toBe("tank");
    expect(afterOver[9]?.updatedAt).toBe(1100);
  });

  it("reads a tab on an older editor's display spelling as the slot code", () => {
    const ghost = applyDragEvent({}, 9, overData, 5, 1000)[9];
    expect(ghost?.fromRoleKey).toBe("damage");
    expect(ghost?.overRoleKey).toBe("tank");
  });

  it("keeps another game's slot codes and starts a frame naming no origin on the open slot", () => {
    const league = applyDragEvent({}, 9, { ...overData, from_role_key: "jungle", over_role_key: "bot" }, 5, 1000)[9];
    expect(league?.fromRoleKey).toBe("jungle");
    expect(league?.overRoleKey).toBe("bot");

    const bare = applyDragEvent({}, 9, { phase: "start", player_id: "7" }, 5, 1000)[9];
    expect(bare?.fromRoleKey).toBe("flex");
  });

  it("removes the ghost on end", () => {
    const afterStart = applyDragEvent({}, 9, startData, 5, 1000);
    const afterEnd = applyDragEvent(afterStart, 9, { phase: "end" }, 5, 1200);
    expect(afterEnd[9]).toBeUndefined();
  });

  it("returns the same map when ending an unknown drag", () => {
    const drags: Record<number, RemoteDrag> = {};
    const result = applyDragEvent(drags, 9, { phase: "end" }, 5, 1200);
    expect(result).toBe(drags);
  });
});

describe("pruneStaleDrags", () => {
  it("drops ghosts older than the TTL and keeps fresh ones", () => {
    const drags = {
      ...applyDragEvent({}, 1, startData, 99, 1000),
      ...applyDragEvent({}, 2, startData, 99, 5000),
    };
    const pruned = pruneStaleDrags(drags, 5500, 2000);
    expect(pruned[1]).toBeUndefined();
    expect(pruned[2]?.userId).toBe(2);
  });

  it("returns the same reference when nothing is stale", () => {
    const drags = applyDragEvent({}, 1, startData, 99, 5000);
    const pruned = pruneStaleDrags(drags, 5500, 2000);
    expect(pruned).toBe(drags);
  });
});
