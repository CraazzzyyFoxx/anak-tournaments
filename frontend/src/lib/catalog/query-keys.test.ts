import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { invalidateCatalogSync } from "@/lib/catalog/invalidate";
import { catalogQueryKeys } from "@/lib/catalog/query-keys";

const OW = { discipline: "overwatch" };
const LOL = { discipline: "lol" };

function seed(client: QueryClient, keys: readonly (readonly unknown[])[]) {
  for (const key of keys) client.setQueryData(key, ["cached"]);
}
const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated === true;

describe("catalog query keys", () => {
  it("never share an entry between disciplines, kinds or filters", () => {
    const keys = [
      catalogQueryKeys.list(OW, "character", {}),
      catalogQueryKeys.list(LOL, "character", {}),
      catalogQueryKeys.list(OW, "map", {}),
      catalogQueryKeys.list(OW, "character", { attrs: { class: "tank" } }),
      catalogQueryKeys.detail(OW, "character", 1),
      catalogQueryKeys.adminList(OW, "character", {})
    ];
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(keys.length);
  });

  it("a kind invalidation drops that kind's reads (public, detail, admin) and nothing else", async () => {
    const client = new QueryClient();
    const inKind = [
      catalogQueryKeys.list(OW, "map", {}),
      catalogQueryKeys.detail(OW, "map", 5),
      catalogQueryKeys.adminList(OW, "map", { page: 2 })
    ];
    const elsewhere = [
      catalogQueryKeys.list(OW, "character", {}),
      catalogQueryKeys.list(LOL, "map", {})
    ];
    seed(client, [...inKind, ...elsewhere]);

    await client.invalidateQueries({ queryKey: catalogQueryKeys.kind(OW, "map") });

    expect(inKind.every((key) => invalidated(client, key))).toBe(true);
    expect(elsewhere.some((key) => invalidated(client, key))).toBe(false);
  });
});

describe("invalidateCatalogSync", () => {
  it("drops every kind and the statistic families of the synced discipline, not another game's", async () => {
    const client = new QueryClient();
    const synced = [
      catalogQueryKeys.list(LOL, "character", {}),
      catalogQueryKeys.list(LOL, "map", {}),
      catalogQueryKeys.adminList(LOL, "mode", {}),
      ["character-stats", 7, "lol", "all"],
      ["user-stats", 3, 7, "lol", "heroes"]
    ];
    const untouched = [
      catalogQueryKeys.list(OW, "character", {}),
      ["character-stats", 7, "overwatch", "all"],
      ["user-stats", 3, 7, "overwatch", "heroes"],
      ["tournament", 1]
    ];
    seed(client, [...synced, ...untouched]);

    await invalidateCatalogSync(client, "lol");

    expect(synced.every((key) => invalidated(client, key))).toBe(true);
    expect(untouched.some((key) => invalidated(client, key))).toBe(false);
  });
});
