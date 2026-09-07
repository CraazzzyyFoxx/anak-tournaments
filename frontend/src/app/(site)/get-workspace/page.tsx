import { getTranslations } from "next-intl/server";
import { Globe, Palette, BarChart3, Users } from "lucide-react";

import { CreateWorkspaceLauncher } from "@/components/CreateWorkspaceLauncher";

/**
 * Explains what a workspace is and lets a visitor create one on the spot.
 *
 * This is the only workspace-creation surface a plain account can reach:
 * `/admin/*` refuses anyone who administers nothing (`canAccessAdminRoute` →
 * `hasAdminPanelAccessForProfile`), which is precisely the visitor this page
 * serves. The home page's communities grid already links here, so the funnel
 * ends where it always pointed — it just no longer ends at "email the admin".
 *
 * Feature tiles + a separate dashed action block, not one shadcn <Card> with
 * a wall-of-text description: the three things a workspace gives you (own
 * address, own theme, separate content) read as a scan-able list instead of
 * a parenthetical aside, and the call to action gets its own visual weight
 * instead of trailing off the same paragraph.
 * The dashed-border tile echoes the "Get your own workspace" tile that links
 * here from the home page's communities grid (see (home)/page.tsx
 * `GetWorkspaceCard`), so the destination page picks up the same visual cue.
 *
 * Centered in the available viewport height (min-h-[60vh]) rather than
 * pinned to the top with py-16: a single short card left a large dead void
 * above the footer when top-anchored.
 */
export default async function GetWorkspacePage() {
  const t = await getTranslations();

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center py-16">
      <div className="text-center">
        <h1 className="text-balance font-display text-2xl uppercase tracking-wide text-foreground sm:text-3xl">
          {t("getWorkspace.title")}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          {t("getWorkspace.lead")}
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-card/50 p-5">
          <div
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--aqt-border-2)] text-[color:var(--aqt-teal)]"
            style={{ background: "color-mix(in srgb, var(--aqt-teal) 12%, transparent)" }}
          >
            <Globe className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-foreground">{t("getWorkspace.features.domain.title")}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("getWorkspace.features.domain.description")}
          </p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/50 p-5">
          <div
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--aqt-border-2)] text-[color:var(--aqt-teal)]"
            style={{ background: "color-mix(in srgb, var(--aqt-teal) 12%, transparent)" }}
          >
            <Palette className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-foreground">{t("getWorkspace.features.theme.title")}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("getWorkspace.features.theme.description")}
          </p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/50 p-5">
          <div
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--aqt-border-2)] text-[color:var(--aqt-teal)]"
            style={{ background: "color-mix(in srgb, var(--aqt-teal) 12%, transparent)" }}
          >
            <BarChart3 className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-foreground">{t("getWorkspace.features.content.title")}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("getWorkspace.features.content.description")}
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-start gap-4 rounded-xl border border-dashed border-border/60 p-5">
        <div
          aria-hidden
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 text-muted-foreground/60"
        >
          <Users className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{t("getWorkspace.action.title")}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("getWorkspace.action.description")}
          </p>
          <CreateWorkspaceLauncher />
        </div>
      </div>
    </div>
  );
}
