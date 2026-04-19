import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

describe("TournamentBracketPage", () => {
  it("mounts tournament realtime with the tournament and workspace ids", () => {
    const source = readFileSync(join(import.meta.dir, "TournamentBracketPage.tsx"), "utf8");

    expect(source).toContain("useTournamentRealtime({");
    expect(source).toContain("tournamentId: tournament.id");
    expect(source).toContain("workspaceId: tournament.workspace_id");
    expect(source).toContain("onStructureChanged: () => router.refresh()");
  });
});
