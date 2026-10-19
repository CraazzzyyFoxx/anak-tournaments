"use client";

import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SaveBar } from "@/components/kit/SaveBar";
import { SettingGroup, SettingRow } from "@/components/kit/SettingRow";
import { WorkspaceSettingsFrame } from "./WorkspaceSettingsFrame";
import { useWorkspaceSettingsForm } from "./useWorkspaceSettingsForm";

/**
 * Who can find this workspace, and whose history counts when a roster decides
 * a player is new.
 *
 * Newcomer scope reads like a rating knob rather than a visibility one, but it
 * is the same question in reverse — how much of the platform this workspace
 * considers itself part of — and it has no other home.
 */
export function VisibilitySection({ workspaceId }: Readonly<{ workspaceId: number | null }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.visibility");
  const settings = useWorkspaceSettingsForm(workspaceId, "visibility");
  const { patch } = settings;

  return (
    <WorkspaceSettingsFrame workspaceId={workspaceId} settings={settings}>
      {({ form: values }) => (
        <>
          <SettingGroup title={t("groups.discovery.title")}>
            <SettingRow htmlFor="workspace-is-hidden" label={t("hidden")} hint={t("hiddenHelp")}>
              <Switch
                id="workspace-is-hidden"
                checked={values.is_hidden}
                onCheckedChange={(checked) => patch({ is_hidden: checked })}
              />
            </SettingRow>
          </SettingGroup>

          <SettingGroup title={t("groups.newcomers.title")}>
            {/* A ToggleGroup is not a labelable element, so the row's
                `<label>` cannot name it; it carries the name itself. */}
            <SettingRow label={t("newcomerScope")} hint={t("scopeHelp")}>
              <ToggleGroup
                type="single"
                value={values.newcomer_scope}
                onValueChange={(value) =>
                  patch({ newcomer_scope: value as "global" | "workspace" })
                }
                aria-label={t("newcomerScope")}
              >
                <ToggleGroupItem value="global">{t("platformWide")}</ToggleGroupItem>
                <ToggleGroupItem value="workspace">{t("workspaceOnly")}</ToggleGroupItem>
              </ToggleGroup>
            </SettingRow>
          </SettingGroup>

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
