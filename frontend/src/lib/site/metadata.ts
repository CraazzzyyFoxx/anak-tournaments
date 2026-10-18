import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import workspaceService from "@/services/workspace.service";
import { SITE_NAME, SITE_URL_OBJ, SITE_FAVICON } from "@/config/site";

export interface SiteMetadata {
  name: string;
  description: string;
  origin: string;
  icon: string;
}

// Game-neutral: the platform hosts every installed game, so its own SEO text
// names none. A game name belongs to a selected game or an actual owner.
async function platformDefaults(origin: string): Promise<SiteMetadata> {
  let description = `${SITE_NAME} — community tournaments, brackets and player statistics.`;
  try {
    description = (await getTranslations("home.meta"))("description", { siteName: SITE_NAME });
  } catch {
    // No request scope for translations (build time): the English default stands.
  }
  return { name: SITE_NAME, description, origin, icon: SITE_FAVICON };
}

/**
 * Per-request SEO metadata, resolved from the tenant host's workspace.
 *
 * On a tenant host, `proxy.ts` (Task 6) injects `x-owt-workspace-id`
 * ahead of the request. When present, the workspace's own SEO fields
 * (`seo_title` / `seo_description` / `icon_url`) drive the page title, OG
 * tags, and favicon, and `origin` becomes the tenant host itself (so
 * `metadataBase`/canonical resolve to that subdomain). On the apex host (no
 * workspace header) — or if anything above fails, including reading the
 * request headers themselves — this falls back to the platform defaults.
 * Never throws: callers can await this unconditionally in
 * `generateMetadata()`.
 */
export async function resolveSiteMetadata(): Promise<SiteMetadata> {
  try {
    const h = await headers();
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]?.trim();
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    let origin = SITE_URL_OBJ.origin;
    if (host) {
      try {
        origin = new URL(`${proto}://${host}`).origin;
      } catch {
        origin = SITE_URL_OBJ.origin;
      }
    }

    const wsId = h.get("x-owt-workspace-id");
    if (!wsId) {
      return await platformDefaults(origin);
    }

    try {
      const ws = await workspaceService.getById(Number(wsId));
      return {
        name: ws.seo_title || ws.name,
        description: ws.seo_description || ws.description || `${ws.name} — tournaments`,
        origin,
        icon: ws.icon_url || SITE_FAVICON
      };
    } catch {
      return await platformDefaults(origin);
    }
  } catch {
    return await platformDefaults(SITE_URL_OBJ.origin);
  }
}
