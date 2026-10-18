import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

import { legacyCatalogSearch, type LegacyKind, type LegacyResolution } from "./legacy-redirect";

const OLD: Record<string, LegacyResolution> = {
  "hero:3": { entityId: 903, discipline: "overwatch", kind: "character" },
  "hero:4": { entityId: 904, discipline: "overwatch", kind: "character" },
  "map:7": { entityId: 907, discipline: "overwatch", kind: "map" }
};
const resolve = async (kind: LegacyKind, id: string) => OLD[`${kind}:${id}`] ?? null;

describe("legacyCatalogSearch", () => {
  it("moves the hero of the leaderboard and names its discipline", async () => {
    expect(
      await legacyCatalogSearch(
        "/users/heroes-compare",
        new URLSearchParams("hero_id=3&tournament_id=9"),
        resolve
      )
    ).toBe("?hero_id=903&tournament_id=9&discipline=overwatch");
  });

  it("moves every catalog param of the compare page, with one discipline", async () => {
    const search = new URLSearchParams("user_id=1&left_hero_id=3&right_hero_id=4&map_id=7");
    expect(await legacyCatalogSearch("/users/compare", search, resolve)).toBe(
      "?user_id=1&left_hero_id=903&right_hero_id=904&map_id=907&discipline=overwatch"
    );
  });

  it("moves the map filter of a tournament's matches without a discipline (owner surface)", async () => {
    expect(
      await legacyCatalogSearch(
        "/tournaments/anak-open/matches",
        new URLSearchParams("map=7"),
        resolve
      )
    ).toBe("?map=907");
  });

  it("leaves an explicit discipline as typed, even when it names another game", async () => {
    expect(
      await legacyCatalogSearch(
        "/users/heroes-compare",
        new URLSearchParams("hero_id=3&discipline=lol"),
        resolve
      )
    ).toBe("?hero_id=903&discipline=lol");
  });

  it("takes the discipline of the resolver, not a fixed game", async () => {
    const lol = async () => ({ entityId: 501, discipline: "lol", kind: "character" as const });
    expect(
      await legacyCatalogSearch("/users/heroes-compare", new URLSearchParams("hero_id=3"), lol)
    ).toBe("?hero_id=501&discipline=lol");
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

  it("does not add a discipline when nothing moved", async () => {
    expect(
      await legacyCatalogSearch(
        "/users/compare",
        new URLSearchParams("left_hero_id=903"),
        async () => ({ entityId: 903, discipline: "overwatch", kind: "character" })
      )
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

  it("permanently redirects before tenant lookup and caches the old id's resolution with its discipline", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
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
        "https://tenant.invalid/users/heroes-compare?hero_id=903&tournament_id=9&discipline=overwatch"
      );
    }
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "http://catalog.internal/api/v1/catalog/legacy/hero/3",
      {
        headers: { accept: "application/json" }
      }
    );
  });

  it("redirects a tournament's matches filter without adding a discipline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify({ entity_id: 977, discipline: "overwatch", kind: "map", slug: "ilios" }))
      )
    );
    const response = await proxy(new NextRequest("https://localhost/tournaments/anak-open/matches?map=77&page=2"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://localhost/tournaments/anak-open/matches?map=977&page=2");
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

  it("ignores a resolver reply without a discipline rather than redirecting to an ownerless id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(JSON.stringify({ entity_id: 905, slug: "x" })))
    );

    const response = await proxy(new NextRequest("https://localhost/users/heroes-compare?hero_id=5"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
