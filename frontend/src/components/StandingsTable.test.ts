import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

describe("StandingsTable", () => {
  it("shows group labels only for group standings", () => {
    const source = readFileSync(join(import.meta.dir, "StandingsTable.tsx"), "utf8");

    expect(source).toContain("{is_groups && standing.team?.group?.name && (");
  });
});
