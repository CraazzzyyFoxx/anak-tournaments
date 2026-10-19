"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { SaveBar } from "@/components/kit/SaveBar";
import { BrandColorField } from "./BrandColorField";
import { BrandPalettePreview } from "./BrandPalettePreview";
import { WorkspaceSettingsFrame } from "./WorkspaceSettingsFrame";
import { useWorkspaceSettingsForm } from "./useWorkspaceSettingsForm";

/**
 * The workspace's public-site palette: four seed colours, six optional
 * overrides, and a preview of what they derive to.
 */
export function BrandingSection({ workspaceId }: Readonly<{ workspaceId: number | null }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.branding");
  const settings = useWorkspaceSettingsForm(workspaceId, "branding");
  const { patch } = settings;

  return (
    <WorkspaceSettingsFrame workspaceId={workspaceId} settings={settings}>
      {({ form: values }) => (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="branding-enabled">{t("siteBranding")}</Label>
                  <p className="text-xs text-muted-foreground">{t("siteBrandingHelp")}</p>
                </div>
                <Switch
                  id="branding-enabled"
                  checked={values.branding_enabled}
                  onCheckedChange={(checked) => patch({ branding_enabled: checked })}
                />
              </div>

              <div>
                <h2 className={EYEBROW_CLASS}>{t("seedColours")}</h2>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <BrandColorField
                    id="brand-primary"
                    label={t("primaryAccent")}
                    value={values.brand_primary}
                    onChange={(value) => patch({ brand_primary: value })}
                  />
                  <BrandColorField
                    id="brand-secondary"
                    label={t("secondaryAccent")}
                    value={values.brand_secondary}
                    onChange={(value) => patch({ brand_secondary: value })}
                  />
                  <BrandColorField
                    id="brand-background"
                    label={t("background")}
                    value={values.brand_background}
                    onChange={(value) => patch({ brand_background: value })}
                  />
                  <BrandColorField
                    id="brand-surface"
                    label={t("surface")}
                    value={values.brand_surface}
                    onChange={(value) => patch({ brand_surface: value })}
                  />
                </div>
              </div>

              <div>
                <h2 className={EYEBROW_CLASS}>{t("corePalette")}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{t("corePaletteHelp")}</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <BrandColorField
                    id="brand-accent"
                    label={t("accent")}
                    value={values.brand_accent}
                    onChange={(value) => patch({ brand_accent: value })}
                  />
                  <BrandColorField
                    id="brand-foreground"
                    label={t("foreground")}
                    value={values.brand_foreground}
                    onChange={(value) => patch({ brand_foreground: value })}
                  />
                  <BrandColorField
                    id="brand-muted"
                    label={t("mutedSurface")}
                    value={values.brand_muted}
                    onChange={(value) => patch({ brand_muted: value })}
                  />
                  <BrandColorField
                    id="brand-border"
                    label={t("border")}
                    value={values.brand_border}
                    onChange={(value) => patch({ brand_border: value })}
                  />
                  <BrandColorField
                    id="brand-ring"
                    label={t("focusRing")}
                    value={values.brand_ring}
                    onChange={(value) => patch({ brand_ring: value })}
                  />
                  <BrandColorField
                    id="brand-destructive"
                    label={t("destructive")}
                    value={values.brand_destructive}
                    onChange={(value) => patch({ brand_destructive: value })}
                  />
                </div>
              </div>

              <BrandPalettePreview branding={values} />
            </CardContent>
          </Card>

          <SaveBar
            dirty={settings.dirty}
            summary={settings.summary}
            saving={settings.saving}
            onDiscard={settings.discard}
            onSave={settings.save}
          />
        </>
      )}
    </WorkspaceSettingsFrame>
  );
}
