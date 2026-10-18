import { createTranslator } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";

// Request state the mocked Next/next-intl entry points read.
let requestHeaders: Record<string, string> = {};
let requestLocale: "en" | "ru" = "en";
const getById = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers(requestHeaders) }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => requestLocale,
  getTranslations: async (namespace?: string) =>
    createTranslator({
      locale: requestLocale,
      messages: requestLocale === "ru" ? ru : en,
      namespace
    } as never)
}));
vi.mock("@/services/workspace.service", () => ({ default: { getById } }));

// `config/site` reads env at module load, like the production build inlines it.
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of [
    "NEXT_PUBLIC_SITE_NAME",
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_SITE_ICON",
    "NEXT_PUBLIC_SITE_FAVICON"
  ]) {
    if (env[key] === undefined) vi.stubEnv(key, undefined as never);
    else vi.stubEnv(key, env[key]);
  }
  const [site, metadata, route] = await Promise.all([
    import("@/config/site"),
    import("@/lib/site/metadata"),
    import("@/lib/site/route-metadata")
  ]);
  return { site, ...metadata, ...route };
}

beforeEach(() => {
  requestHeaders = { host: "owt.craazzzyyfoxx.me" };
  requestLocale = "en";
  getById.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("site config boundary", () => {
  it.each([undefined, "", "   "])("treats %j as unset for every site input", async (blank) => {
    const { site } = await load({
      NEXT_PUBLIC_SITE_NAME: blank,
      NEXT_PUBLIC_SITE_URL: blank,
      NEXT_PUBLIC_SITE_ICON: blank,
      NEXT_PUBLIC_SITE_FAVICON: blank
    });
    expect(site.SITE_NAME).toBe("OWT");
    expect(site.SITE_URL).toBe("https://owt.craazzzyyfoxx.me");
    expect(site.SITE_ICON).toBe("/logo.webp");
    expect(site.SITE_FAVICON).toBe("/favicon.ico");
  });

  it("keeps explicitly configured values, including a game-branded name", async () => {
    const { site } = await load({
      NEXT_PUBLIC_SITE_NAME: "Overwatch Tournaments",
      NEXT_PUBLIC_SITE_URL: "https://example.test",
      NEXT_PUBLIC_SITE_ICON: "/brand.png",
      NEXT_PUBLIC_SITE_FAVICON: "/brand.ico"
    });
    expect([site.SITE_NAME, site.SITE_URL, site.SITE_ICON, site.SITE_FAVICON]).toEqual([
      "Overwatch Tournaments",
      "https://example.test",
      "/brand.png",
      "/brand.ico"
    ]);
  });
});

describe("platform metadata", () => {
  it("is game-neutral and named OWT when the name input is empty", async () => {
    const { resolveSiteMetadata } = await load({ NEXT_PUBLIC_SITE_NAME: "" });
    const meta = await resolveSiteMetadata();
    expect(meta.name).toBe("OWT");
    expect(meta.description).toContain("OWT");
    expect(meta.description).not.toMatch(/overwatch|blizzard/i);
    expect(meta.origin).toBe("https://owt.craazzzyyfoxx.me");
  });

  it("localizes the default description to the request locale", async () => {
    requestLocale = "ru";
    const { resolveSiteMetadata } = await load({});
    const meta = await resolveSiteMetadata();
    expect(meta.description).toBe(ru.home.meta.description.replace("{siteName}", "OWT"));
    expect(meta.description).not.toMatch(/overwatch/i);
  });

  it("uses an explicit product name where one is configured", async () => {
    const { resolveSiteMetadata } = await load({ NEXT_PUBLIC_SITE_NAME: "Overwatch Tournaments" });
    const meta = await resolveSiteMetadata();
    expect(meta.name).toBe("Overwatch Tournaments");
    expect(meta.description).toContain("Overwatch Tournaments");
  });

  it("serves a tenant's own title, description, icon and custom-domain origin", async () => {
    requestHeaders = {
      "x-forwarded-host": "league.example.org",
      "x-forwarded-proto": "https",
      "x-owt-workspace-id": "7"
    };
    getById.mockResolvedValue({
      name: "League",
      seo_title: "The League",
      seo_description: "League brackets",
      description: null,
      icon_url: "/league.png"
    });
    const { resolveSiteMetadata } = await load({});
    expect(await resolveSiteMetadata()).toEqual({
      name: "The League",
      description: "League brackets",
      origin: "https://league.example.org",
      icon: "/league.png"
    });
    expect(getById).toHaveBeenCalledWith(7);
  });

  it("falls back from blank tenant SEO fields to the workspace name and platform favicon", async () => {
    requestHeaders = { host: "t.example.org", "x-owt-workspace-id": "7" };
    getById.mockResolvedValue({
      name: "League",
      seo_title: "",
      seo_description: "",
      description: "",
      icon_url: ""
    });
    const { resolveSiteMetadata } = await load({});
    const meta = await resolveSiteMetadata();
    expect([meta.name, meta.icon]).toEqual(["League", "/favicon.ico"]);
    expect(meta.description).toBe("League — tournaments");
  });

  it("returns the platform defaults when the tenant lookup fails", async () => {
    requestHeaders = { host: "t.example.org", "x-owt-workspace-id": "7" };
    getById.mockRejectedValue(new Error("boom"));
    const { resolveSiteMetadata } = await load({});
    const meta = await resolveSiteMetadata();
    expect([meta.name, meta.origin]).toEqual(["OWT", "https://t.example.org"]);
  });
});

describe("route metadata", () => {
  it("builds the title and description from the resolved tenant name, not the build-time one", async () => {
    requestHeaders = {
      "x-forwarded-host": "league.example.org",
      "x-owt-workspace-id": "7"
    };
    getById.mockResolvedValue({ name: "League", seo_title: "The League", icon_url: null });
    const { buildSiteRouteMetadata } = await load({ NEXT_PUBLIC_SITE_NAME: "Build Time Name" });
    const metadata = await buildSiteRouteMetadata({
      titleKey: "statistics.navTitle",
      descriptionKey: "statistics.metaDescription"
    });
    expect(metadata.title).toBe(`${en.statistics.navTitle} | The League`);
    expect(metadata.description).toBe("View statistics on The League.");
    expect(metadata.openGraph).toMatchObject({
      siteName: "The League",
      url: "https://league.example.org",
      locale: "en_US"
    });
    expect(String(metadata.metadataBase)).toBe("https://league.example.org/");
  });

  it("uses the platform name on the platform host and the request locale for OpenGraph", async () => {
    requestLocale = "ru";
    const { buildSiteRouteMetadata } = await load({ NEXT_PUBLIC_SITE_NAME: "" });
    const metadata = await buildSiteRouteMetadata({
      titleKey: "statistics.navTitle",
      descriptionKey: "statistics.metaDescription"
    });
    expect(metadata.title).toBe(`${ru.statistics.navTitle} | OWT`);
    expect(metadata.openGraph).toMatchObject({ siteName: "OWT", locale: "ru_RU" });
  });
});
