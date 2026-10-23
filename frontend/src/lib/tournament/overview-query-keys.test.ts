import { describe, expect, it } from "vitest";

import { tournamentQueryKeys } from "./query-keys";

describe("encountersOverview key", () => {
  it("separates games in both the scoped and the unscoped branch", () => {
    for (const workspace of [undefined, null, 4, "all"] as const) {
      const lol = tournamentQueryKeys.encountersOverview(workspace, "lol");
      const ow = tournamentQueryKeys.encountersOverview(workspace, "overwatch");
      const every = tournamentQueryKeys.encountersOverview(workspace, null);
      expect(lol).not.toEqual(ow);
      expect(lol).not.toEqual(every);
      expect(every).toEqual(tournamentQueryKeys.encountersOverview(workspace));
    }
  });

  it("separates workspaces for one game", () => {
    expect(tournamentQueryKeys.encountersOverview(1, "lol")).not.toEqual(tournamentQueryKeys.encountersOverview(2, "lol"));
    expect(tournamentQueryKeys.encountersOverview(null, "lol")).not.toEqual(tournamentQueryKeys.encountersOverview(1, "lol"));
  });
});
