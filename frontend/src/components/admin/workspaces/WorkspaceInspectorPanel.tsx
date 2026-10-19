"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";

import { EYEBROW_CLASS } from "@/components/kit/tone";
import { WorkspaceOwnerValue } from "@/components/admin/workspace-owner";
import { Button } from "@/components/ui/button";
import type { Workspace } from "@/types/workspace.types";

function InspectorField({
  label,
  children
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <p className="mt-0.5 break-words text-sm text-foreground">{children}</p>
    </div>
  );
}

/** The open workspace's settings at a glance; changing any of them happens under `[id]/`. */
export function WorkspaceInspectorPanel({ workspace }: Readonly<{ workspace: Workspace }>) {
  const t = useTranslations("adminAccess.common");
  const tw = useTranslations("adminAccess.workspace");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <InspectorField label={t("status")}>
          {workspace.is_active ? t("active") : t("inactive")}
        </InspectorField>
        <InspectorField label={t("visibility")}>
          {workspace.is_hidden ? tw("hiddenFromPublic") : t("listed")}
        </InspectorField>
        <InspectorField label={t("timezone")}>{workspace.timezone}</InspectorField>
        <InspectorField label={t("branding")}>
          {workspace.branding_enabled ? t("customBranding") : t("platformDefault")}
        </InspectorField>
        <InspectorField label={t("subdomain")}>{workspace.subdomain ?? "—"}</InspectorField>
        <InspectorField label={t("customDomain")}>
          {workspace.custom_domain
            ? `${workspace.custom_domain}${workspace.custom_domain_verified_at ? "" : " (unverified)"}`
            : "—"}
        </InspectorField>
        <InspectorField label={t("discordGuild")}>
          {workspace.discord_guild_id ?? "—"}
        </InspectorField>
        <InspectorField label={t("newcomers")}>
          {workspace.newcomer_scope === "global" ? t("anyWorkspace") : t("thisWorkspace")}
        </InspectorField>
        <InspectorField label={t("owner")}>
          <WorkspaceOwnerValue workspaceId={workspace.id} />
        </InspectorField>
      </div>

      <div>
        <p className={EYEBROW_CLASS}>{t("description")}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {workspace.description || t("noDescription")}
        </p>
      </div>
    </div>
  );
}

/** The header actions of the same row: edit goes to the settings sections, delete stays here. */
export function WorkspaceInspectorActions({
  workspace,
  canEdit,
  canDelete,
  onDelete
}: Readonly<{
  workspace: Workspace;
  canEdit: boolean;
  canDelete: boolean;
  onDelete: (workspace: Workspace) => void;
}>) {
  const t = useTranslations("adminAccess.common");

  return (
    <>
      {canEdit ? (
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/workspaces/${workspace.id}/general`}>
            <Pencil aria-hidden className="size-3.5" />
            {t("edit")}
          </Link>
        </Button>
      ) : null}
      {canDelete ? (
        <Button
          variant="outline"
          size="sm"
          className="text-danger"
          onClick={() => onDelete(workspace)}
        >
          <Trash2 aria-hidden className="size-3.5" />
          {t("delete")}
        </Button>
      ) : null}
    </>
  );
}
