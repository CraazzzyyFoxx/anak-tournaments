"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SaveBar } from "@/components/kit/SaveBar";
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
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="workspace-is-hidden">{t("hidden")}</Label>
                  <p className="max-w-prose text-xs text-muted-foreground">
                    {t("hiddenHelp")}
                  </p>
                </div>
                <Switch
                  id="workspace-is-hidden"
                  checked={values.is_hidden}
                  onCheckedChange={(checked) => patch({ is_hidden: checked })}
                />
              </div>

              <div>
                <Label htmlFor="workspace-newcomer-scope">{t("newcomerScope")}</Label>
                <Select
                  value={values.newcomer_scope}
                  onValueChange={(value) =>
                    patch({ newcomer_scope: value as "global" | "workspace" })
                  }
                >
                  <SelectTrigger id="workspace-newcomer-scope" className="mt-1.5 w-full">
                    <SelectValue placeholder={t("selectScope")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">{t("platformWide")}</SelectItem>
                    <SelectItem value="workspace">{t("workspaceOnly")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 max-w-prose text-xs text-muted-foreground">
                  {t("scopeHelp")}
                </p>
              </div>
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
