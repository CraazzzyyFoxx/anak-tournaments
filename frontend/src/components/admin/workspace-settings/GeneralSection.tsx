"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";

import { EditableAvatar } from "@/components/ui/editable-avatar";
import { Input } from "@/components/ui/input";
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
import { SettingGroup, SettingRow } from "@/components/kit/SettingRow";
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
import { SettingsHeaderActions } from "./WorkspaceSettingsShell";
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
 * received. It shares the `immediate` group with the owner and tier controls,
 * which also act on their own, so no group mixes the two save models.
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
              It sits in the page header, beside the title it audits. */}
          <SettingsHeaderActions>
            <AuditTrailButton
              scope={{
                entityType: "workspace",
                entityId: workspace.id,
                workspaceId: workspace.id
              }}
              target={t("auditTarget", { name: workspace.name })}
              showCount
            />
          </SettingsHeaderActions>

          <WorkspaceNotListedNotice status={workspace.verification_status} />

          <SettingGroup
            title={t("groups.identity.title")}
            description={t("groups.identity.description")}
          >
            <SettingRow htmlFor="workspace-name" label={t("name")}>
              <Input
                id="workspace-name"
                value={values.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </SettingRow>
            <SettingRow htmlFor="workspace-timezone" label={t("timezone")} hint={t("timezoneHelp")}>
              <Select value={values.timezone} onValueChange={(value) => patch({ timezone: value })}>
                <SelectTrigger id="workspace-timezone" className="w-full">
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
            </SettingRow>
          </SettingGroup>

          <SettingGroup
            title={t("groups.publicPage.title")}
            description={t("groups.publicPage.description")}
          >
            {/* Mirrors only the avatar, tagline and name of the public header
                (`CommunityTop`, app/(site)/workspace/_components/
                CommunityHero.tsx). That hero also carries the founding year,
                the trust badge, the description, the links and the call to
                action, which are left out here. */}
            <SettingRow label={t("groups.publicPage.preview")}>
              <figure
                aria-label={t("groups.publicPage.preview")}
                className="flex min-w-0 items-center gap-4"
              >
                <WorkspaceAvatar workspace={{ ...workspace, name: values.name }} size={48} />
                <div className="min-w-0">
                  {values.tagline ? <p className={EYEBROW_CLASS}>{values.tagline}</p> : null}
                  <p className="mt-1 text-lg font-semibold [overflow-wrap:anywhere]">
                    {values.name}
                  </p>
                </div>
              </figure>
            </SettingRow>
            <SettingRow htmlFor="workspace-tagline" label={t("tagline")} hint={t("taglineHelp")}>
              <Input
                id="workspace-tagline"
                maxLength={120}
                value={values.tagline}
                onChange={(event) => patch({ tagline: event.target.value })}
              />
            </SettingRow>
            <SettingRow htmlFor="workspace-description" label={t("description")} stacked>
              <Textarea
                id="workspace-description"
                value={values.description}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </SettingRow>
            <SettingRow htmlFor="workspace-about" label={t("about")} hint={t("aboutHelp")} stacked>
              <Textarea
                id="workspace-about"
                className="min-h-40 font-mono"
                maxLength={4000}
                value={values.about}
                onChange={(event) => patch({ about: event.target.value })}
              />
            </SettingRow>
          </SettingGroup>

          <SettingGroup title={t("groups.links.title")} description={t("groups.links.description")}>
            {LINK_FIELDS.map(({ key, labelKey, placeholder }) => (
              <SettingRow key={key} htmlFor={`workspace-${key}`} label={t(labelKey)}>
                <Input
                  id={`workspace-${key}`}
                  type="url"
                  inputMode="url"
                  placeholder={placeholder}
                  value={values[key]}
                  onChange={(event) => patch({ [key]: event.target.value })}
                />
              </SettingRow>
            ))}
          </SettingGroup>

          {/* The reassign, transfer and tier controls are rows of their own
              that render nothing for a caller they are not offered to, so
              this group never shows an empty row. */}
          <SettingGroup
            title={t("groups.iconOwnership.title")}
            description={t("groups.iconOwnership.description")}
            immediate
          >
            <SettingRow label={t("icon")} hint={t("iconHelp")}>
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
            </SettingRow>
            <SettingRow label={t("owner")} hint={t("ownerHelp")}>
              <div className="text-sm">
                <WorkspaceOwnerValue workspaceId={workspace.id} />
              </div>
            </SettingRow>
            <WorkspaceOwnerControl workspaceId={workspace.id} isSuperuser={isSuperuser} />
            <WorkspaceOwnerTransferControl
              workspaceId={workspace.id}
              workspaceName={workspace.name}
              isSuperuser={isSuperuser}
            />
            <WorkspaceVerificationControl
              workspace={workspace}
              isSuperuser={isSuperuser}
              onChanged={invalidate}
            />
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
