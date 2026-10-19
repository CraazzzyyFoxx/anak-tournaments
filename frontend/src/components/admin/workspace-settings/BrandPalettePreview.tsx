"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { deriveWorkspacePalette } from "@/lib/workspace/theme";
import type { WorkspaceBranding } from "@/types/workspace.types";

/**
 * What the brand colours derive to, as a strip of four swatches on the derived
 * ground. Each swatch names itself through `title`/`aria-label` only: a
 * labelled block would read as a chip (DESIGN §4).
 *
 * Always rendered as if branding were on, so the palette can be judged before
 * the switch commits it to the public site. Shared by the Branding section and
 * the workspace wizard.
 */
export function BrandPalettePreview({ branding }: Readonly<{ branding: WorkspaceBranding }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.branding");
  const preview = deriveWorkspacePalette({ ...branding, branding_enabled: true });
  if (!preview) return null;

  const swatches = [
    { key: "primary", label: t("primary"), style: { background: "var(--aqt-teal)" } },
    { key: "secondary", label: t("secondary"), style: { background: "var(--aqt-violet)" } },
    {
      key: "surface",
      label: t("surface"),
      style: { background: "var(--aqt-card)", border: "1px solid var(--aqt-border)" }
    },
    { key: "destructive", label: t("destructive"), style: { background: "hsl(var(--destructive))" } }
  ];

  return (
    <div
      className="rounded-md border border-border p-3"
      style={{ ...preview, background: "var(--aqt-bg)" } as CSSProperties}
    >
      <p className="text-xs font-medium" style={{ color: "var(--aqt-fg)" }}>
        {t("preview")}
      </p>
      <div className="mt-2 flex gap-2">
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
    </div>
  );
}
