"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { EditableAvatar } from "@/components/ui/editable-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AuditTrailButton } from "@/components/kit/AuditTrailSheet";
import { SaveBar } from "@/components/kit/SaveBar";
import { SettingGroup } from "@/components/kit/SettingRow";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import {
  WorkspaceOwnerControl,
  WorkspaceOwnerTransferControl,
  WorkspaceOwnerValue
} from "@/components/admin/workspace-owner";
import {
  WorkspaceNotListedNotice,
  WorkspaceVerificationControl
} from "@/components/admin/workspace-verification";
import { WorkspaceAvatar } from "@/components/workspace/WorkspaceAvatar";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { DEFAULT_WORKSPACE_TIMEZONE, getUtcOffsetLabel } from "@/lib/workspace/timezone";
import workspaceService from "@/services/workspace.service";
import { WorkspaceSettingsFrame } from "./WorkspaceSettingsFrame";
import { useWorkspaceSettingsForm } from "./useWorkspaceSettingsForm";

const ACCEPTED_IMAGE_TYPES = "image/webp,image/png,image/jpeg,image/gif";
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

/** The three community links, rendered identically — label, type, example. */
const LINK_FIELDS = [
  { key: "discord_url", labelKey: "linkLabels.discord", placeholder: "https://discord.gg/…" },
  { key: "twitch_url", labelKey: "linkLabels.twitch", placeholder: "https://twitch.tv/…" },
  { key: "boosty_url", labelKey: "linkLabels.boosty", placeholder: "https://boosty.to/…" }
] as const;

/**
 * Name, description, timezone and icon of a workspace.
 *
 * The icon is not part of the `SaveBar` diff: it is a file, not a field, and
 * it travels through its own endpoint — so picking one uploads it and there is
 * no half-saved state where the avatar shown is a `blob:` URL the server never
 * received.
 */
export function GeneralSection({ workspaceId }: Readonly<{ workspaceId: number | null }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.general");
  const settings = useWorkspaceSettingsForm(workspaceId, "general");
  const { isSuperuser } = usePermissions();
  const { form, patch, invalidate } = settings;

  // Every IANA zone the runtime knows, with the saved value kept selectable
  // even when this runtime does not list it.
  const timezoneOptions = useMemo(() => {
    let zones: string[];
    try {
      zones = Intl.supportedValuesOf("timeZone");
    } catch {
      zones = [DEFAULT_WORKSPACE_TIMEZONE, "UTC"];
    }
    const current = form?.timezone;
    return current && !zones.includes(current) ? [current, ...zones] : zones;
  }, [form?.timezone]);

  const uploadIcon = useMutation({
    mutationFn: (file: File) => workspaceService.uploadIcon(workspaceId as number, file),
    onSuccess: () => {
      invalidate();
      notify.success(t("iconUpdated"));
    },
    onError: (error) => notify.apiError(error, { title: t("uploadIconError") })
  });

  const deleteIcon = useMutation({
    mutationFn: () => workspaceService.deleteIcon(workspaceId as number),
    onSuccess: () => {
      invalidate();
      notify.success(t("iconRemoved"));
    },
    onError: (error) => notify.apiError(error, { title: t("removeIconError") })
  });

  return (
    <WorkspaceSettingsFrame workspaceId={workspaceId} settings={settings}>
      {({ workspace, form: values }) => (
        <>
          {/* The audit trail is a drawer the whole admin shares, not a section
              of its own: it answers "who changed this" about branding, the
              domain and the guild alike, and General is where the rail lands.
              The name and tier sit on the Overview; here the name is the
              first field. */}
          <div className="flex justify-end">
            <AuditTrailButton
              scope={{
                entityType: "workspace",
                entityId: workspace.id,
                workspaceId: workspace.id
              }}
              target={t("auditTarget", { name: workspace.name })}
              showCount
            />
          </div>

          <WorkspaceNotListedNotice status={workspace.verification_status} />

          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <SettingGroup
                title={t("groups.identity.title")}
                description={t("groups.identity.description")}
              >
                <div className="flex flex-col gap-4">
                  <div>
                    <Label htmlFor="workspace-name">{t("name")}</Label>
                    <Input
                      id="workspace-name"
                      className="mt-1.5"
                      value={values.name}
                      onChange={(event) => patch({ name: event.target.value })}
                    />
                  </div>

                  <div>
                    <p className="text-sm font-medium leading-none">{t("icon")}</p>
                    <div className="mt-1.5">
                      <EditableAvatar
                        src={workspace.icon_url}
                        name={values.name}
                        size={64}
                        shape="rounded"
                        busy={uploadIcon.isPending || deleteIcon.isPending}
                        onSelectFile={(file) => uploadIcon.mutate(file)}
                        onDelete={workspace.icon_url ? () => deleteIcon.mutate() : undefined}
                        accept={ACCEPTED_IMAGE_TYPES}
                        maxSizeBytes={MAX_FILE_SIZE}
                        onError={(message) => notify.error(message)}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t("iconHelp")}</p>
                  </div>

                  <div>
                    <p className="text-sm font-medium leading-none">{t("owner")}</p>
                    <div className="mt-1.5 text-sm">
                      <WorkspaceOwnerValue workspaceId={workspace.id} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t("ownerHelp")}</p>
                    <WorkspaceOwnerControl workspaceId={workspace.id} isSuperuser={isSuperuser} />
                    <WorkspaceOwnerTransferControl
                      workspaceId={workspace.id}
                      workspaceName={workspace.name}
                      isSuperuser={isSuperuser}
                    />
                  </div>

                  <WorkspaceVerificationControl
                    workspace={workspace}
                    isSuperuser={isSuperuser}
                    onChanged={invalidate}
                  />
                </div>
              </SettingGroup>

              <SettingGroup
                title={t("groups.publicPage.title")}
                description={t("groups.publicPage.description")}
              >
                <div className="flex flex-col gap-4">
                  {/* Mirrors only the avatar, tagline and name of the public
                      header (`CommunityTop`, app/(site)/workspace/_components/
                      CommunityHero.tsx). That hero also carries the founding
                      year, the trust badge, the description, the links and the
                      call to action, which are left out here. */}
                  <figure className="rounded-md border border-border p-3">
                    <figcaption className="text-xs font-medium">
                      {t("groups.publicPage.preview")}
                    </figcaption>
                    <div className="mt-3 flex items-center gap-4">
                      <WorkspaceAvatar workspace={{ ...workspace, name: values.name }} size={48} />
                      <div className="min-w-0">
                        {values.tagline ? <p className={EYEBROW_CLASS}>{values.tagline}</p> : null}
                        <p className="mt-1 text-lg font-semibold [overflow-wrap:anywhere]">
                          {values.name}
                        </p>
                      </div>
                    </div>
                  </figure>

                  <div>
                    <Label htmlFor="workspace-tagline">{t("tagline")}</Label>
                    <Input
                      id="workspace-tagline"
                      className="mt-1.5"
                      maxLength={120}
                      value={values.tagline}
                      onChange={(event) => patch({ tagline: event.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{t("taglineHelp")}</p>
                  </div>

                  <div>
                    <Label htmlFor="workspace-description">{t("description")}</Label>
                    <Textarea
                      id="workspace-description"
                      className="mt-1.5"
                      value={values.description}
                      onChange={(event) => patch({ description: event.target.value })}
                    />
                  </div>

                  <div>
                    <Label htmlFor="workspace-about">{t("about")}</Label>
                    <Textarea
                      id="workspace-about"
                      className="mt-1.5 min-h-40 font-mono"
                      maxLength={4000}
                      value={values.about}
                      onChange={(event) => patch({ about: event.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{t("aboutHelp")}</p>
                  </div>
                </div>
              </SettingGroup>

              <SettingGroup
                title={t("groups.links.title")}
                description={t("groups.links.description")}
              >
                <div className="flex flex-col gap-4">
                  {LINK_FIELDS.map(({ key, labelKey, placeholder }) => (
                    <div key={key}>
                      <Label htmlFor={`workspace-${key}`}>{t(labelKey)}</Label>
                      <Input
                        id={`workspace-${key}`}
                        className="mt-1.5"
                        type="url"
                        inputMode="url"
                        placeholder={placeholder}
                        value={values[key]}
                        onChange={(event) => patch({ [key]: event.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </SettingGroup>

              <SettingGroup
                title={t("groups.time.title")}
                description={t("groups.time.description")}
              >
                <div>
                  <Label htmlFor="workspace-timezone">{t("timezone")}</Label>
                  <Select
                    value={values.timezone}
                    onValueChange={(value) => patch({ timezone: value })}
                  >
                    <SelectTrigger id="workspace-timezone" className="mt-1.5 w-full">
                      <SelectValue placeholder={t("selectTimezone")} />
                    </SelectTrigger>
                    <SelectContent>
                      {timezoneOptions.map((zone) => (
                        <SelectItem key={zone} value={zone}>
                          {zone} ({getUtcOffsetLabel(zone)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">{t("timezoneHelp")}</p>
                </div>
              </SettingGroup>
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
