"use client";

import { useTranslations } from "next-intl";

import { Switch } from "@/components/ui/switch";
import { SaveBar } from "@/components/kit/SaveBar";
import { SettingGroup, SettingRow } from "@/components/kit/SettingRow";
import { BrandColorField } from "./BrandColorField";
import { BrandPalettePreview, previewPalette } from "./BrandPalettePreview";
import { WorkspaceSettingsFrame } from "./WorkspaceSettingsFrame";
import { useWorkspaceSettingsForm } from "./useWorkspaceSettingsForm";

/** Two colour fields per line from `sm`; the group title labels the grid. */
const COLOUR_GRID_CLASS = "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2";

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
      {({ form: values }) => {
        const palette = previewPalette(values);

        return (
          <>
            <SettingGroup title={t("siteBranding")} description={t("siteBrandingHelp")}>
              <SettingRow htmlFor="branding-enabled" label={t("useCustomPalette")}>
                <Switch
                  id="branding-enabled"
                  checked={values.branding_enabled}
                  onCheckedChange={(checked) => patch({ branding_enabled: checked })}
                />
              </SettingRow>
            </SettingGroup>

            <SettingGroup title={t("seedColours")}>
              <div className={COLOUR_GRID_CLASS}>
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
            </SettingGroup>

            <SettingGroup title={t("corePalette")} description={t("corePaletteHelp")}>
              <div className={COLOUR_GRID_CLASS}>
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
            </SettingGroup>

            {palette ? (
              <SettingGroup title={t("preview")}>
                <BrandPalettePreview palette={palette} />
              </SettingGroup>
            ) : null}

            <SaveBar
              dirty={settings.dirty}
              summary={settings.summary}
              saving={settings.saving}
              onDiscard={settings.discard}
              onSave={settings.save}
            />
          </>
        );
      }}
    </WorkspaceSettingsFrame>
  );
}
