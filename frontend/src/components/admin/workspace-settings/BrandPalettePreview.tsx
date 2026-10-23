"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { deriveWorkspacePalette, type CssVarMap } from "@/lib/workspace/theme";
import type { WorkspaceBranding } from "@/types/workspace.types";

/**
 * What `branding` derives to as if it were switched on, so the palette can be
 * judged before the switch commits it to the public site. `null` until a
 * primary accent and a background are set: callers drop the preview and its
 * heading together then.
 */
export function previewPalette(branding: WorkspaceBranding): CssVarMap | null {
  return deriveWorkspacePalette({ ...branding, branding_enabled: true });
}

/**
 * A derived palette as one strip of swatches. Each swatch names itself through
 * `title`/`aria-label` only: a labelled block would read as a chip (DESIGN §4).
 *
 * The strip scopes the derived variables but paints no ground of its own: it
 * sits inside a settings card, and a filled frame there would be a card in a
 * card (DESIGN §5), so the background and the text colour are swatches too.
 * The caller titles it. Shared by the Branding section and the workspace
 * wizard.
 */
export function BrandPalettePreview({ palette }: Readonly<{ palette: CssVarMap }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.branding");
  const edge = "1px solid var(--aqt-border)";

  const swatches = [
    { key: "primary", label: t("primary"), style: { background: "var(--aqt-teal)" } },
    { key: "secondary", label: t("secondary"), style: { background: "var(--aqt-violet)" } },
    {
      key: "background",
      label: t("background"),
      style: { background: "var(--aqt-bg)", border: edge }
    },
    { key: "surface", label: t("surface"), style: { background: "var(--aqt-card)", border: edge } },
    { key: "foreground", label: t("foreground"), style: { background: "var(--aqt-fg)" } },
    {
      key: "destructive",
      label: t("destructive"),
      style: { background: "hsl(var(--destructive))" }
    }
  ];

  return (
    <div className="flex flex-wrap gap-2" style={palette as CSSProperties}>
      {swatches.map((swatch) => (
        <span
          key={swatch.key}
          role="img"
          aria-label={swatch.label}
          title={swatch.label}
          className="h-8 w-12 rounded-md"
          style={swatch.style}
        />
      ))}
    </div>
  );
}
