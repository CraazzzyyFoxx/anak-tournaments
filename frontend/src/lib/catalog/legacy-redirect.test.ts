import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

import { legacyCatalogSearch, type LegacyKind } from "./legacy-redirect";

const OLD: Record<string, number> = { "hero:3": 903, "hero:4": 904, "map:7": 907 };
const resolve = async (kind: LegacyKind, id: string) => OLD[`${kind}:${id}`] ?? null;

describe("legacyCatalogSearch", () => {
  it("moves the hero of the leaderboard", async () => {
    expect(
      await legacyCatalogSearch(
        "/users/heroes-compare",
        new URLSearchParams("hero_id=3&tournament_id=9"),
        resolve
      )
    ).toBe("?hero_id=903&tournament_id=9");
  });

  it("moves every catalog param of the compare page", async () => {
    const search = new URLSearchParams("user_id=1&left_hero_id=3&right_hero_id=4&map_id=7");
    expect(await legacyCatalogSearch("/users/compare", search, resolve)).toBe(
      "?user_id=1&left_hero_id=903&right_hero_id=904&map_id=907"
    );
  });

  it("moves the map filter of a tournament's matches", async () => {
    expect(
      await legacyCatalogSearch(
        "/tournaments/anak-open/matches",
        new URLSearchParams("map=7"),
        resolve
      )
    ).toBe("?map=907");
  });

  it("leaves new ids, non-numbers and other pages alone", async () => {
    expect(
      await legacyCatalogSearch(
        "/users/heroes-compare",
        new URLSearchParams("hero_id=950"),
        resolve
      )
    ).toBeNull();
    expect(
      await legacyCatalogSearch(
        "/users/heroes-compare",
        new URLSearchParams("hero_id=ana"),
        resolve
      )
    ).toBeNull();
    expect(
      await legacyCatalogSearch("/users", new URLSearchParams("hero_id=3"), resolve)
    ).toBeNull();
  });
});

describe("legacy catalog proxy redirects", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_INTERNAL_API_URL", "http://catalog.internal/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("permanently redirects before tenant lookup and caches the old id's new id", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            entity_id: 903,
            discipline: "overwatch",
            kind: "character",
            slug: "ana"
          })
        )
      );
    vi.stubGlobal("fetch", fetch);
    const request = new NextRequest(
      "https://tenant.invalid/users/heroes-compare?hero_id=3&tournament_id=9"
    );

    for (let i = 0; i < 2; i++) {
      const response = await proxy(request);
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        "https://tenant.invalid/users/heroes-compare?hero_id=903&tournament_id=9"
      );
    }
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "http://catalog.internal/api/v1/catalog/legacy/hero/3",
      {
        headers: { accept: "application/json" }
      }
    );
  });

  it("caches a new id's 404 until the lookup TTL expires", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const request = new NextRequest("https://localhost/users/heroes-compare?hero_id=950");

    expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
    expect(fetch).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(160_001);
    expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("leaves the page usable on an API error without caching the failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entity_id: 904,
            discipline: "overwatch",
            kind: "character",
            slug: "ashe"
          })
        )
      );
    vi.stubGlobal("fetch", fetch);
    const request = new NextRequest("https://localhost/users/heroes-compare?hero_id=4");

    expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request)).status).toBe(308);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
