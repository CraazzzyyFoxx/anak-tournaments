"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { deriveWorkspacePalette } from "@/lib/workspace/theme";
import type { WorkspaceBranding } from "@/types/workspace.types";

/**
 * What the brand colours derive to, as four swatches on the derived ground.
 *
 * Always rendered as if branding were on, so the palette can be judged before
 * the switch commits it to the public site. Shared by the Branding section and
 * the workspace wizard.
 */
export function BrandPalettePreview({ branding }: Readonly<{ branding: WorkspaceBranding }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.branding");
  const preview = deriveWorkspacePalette({ ...branding, branding_enabled: true });
  if (!preview) return null;

  return (
    <div
      className="rounded-md border border-border p-3"
      style={{ ...preview, background: "var(--aqt-bg)" } as CSSProperties}
    >
      <p className="text-xs font-medium" style={{ color: "var(--aqt-fg)" }}>
        {t("preview")}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <span
          className="rounded px-2 py-1 text-xs font-medium"
          style={{
            background: "var(--aqt-teal)",
            color: "hsl(var(--primary-foreground))"
          }}
        >
          {t("primary")}
        </span>
        <span
          className="rounded px-2 py-1 text-xs font-medium"
          style={{
            background: "var(--aqt-violet)",
            color: "hsl(var(--secondary-foreground))"
          }}
        >
          {t("secondary")}
        </span>
        <span
          className="rounded px-2 py-1 text-xs"
          style={{
            background: "var(--aqt-card)",
            color: "var(--aqt-fg-muted)",
            border: "1px solid var(--aqt-border)"
          }}
        >
          {t("surface")}
        </span>
        <span
          className="rounded px-2 py-1 text-xs font-medium"
          style={{
            background: "hsl(var(--destructive))",
            color: "hsl(var(--destructive-foreground))"
          }}
        >
          {t("destructive")}
        </span>
      </div>
    </div>
  );
}
