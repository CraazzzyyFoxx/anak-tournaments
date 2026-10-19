"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  WorkspaceNotListedNotice,
  WorkspaceVerificationIcon
} from "@/components/admin/workspace-verification";
import { WorkspaceIcon } from "@/components/admin/workspaces/WorkspaceCells";
import { PLATFORM_ZONE } from "@/lib/site/host";
import { SetupChecklist } from "./SetupChecklist";
import { WorkspaceSettingsFrame } from "./WorkspaceSettingsFrame";
import { useWorkspaceSettingsForm } from "./useWorkspaceSettingsForm";

/**
 * The root of both settings shells: which workspace this is, and what it still
 * lacks. Read-only, so no save bar; every "Set up" link leads into the section
 * that fixes the item.
 *
 * Open rather than carded: `SetupChecklist` frames its own rows, and a card
 * around it would be a card inside a card (DESIGN §5).
 */
export function OverviewSection({ workspaceId }: Readonly<{ workspaceId: number | null }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.overview");
  const settings = useWorkspaceSettingsForm(workspaceId, "overview");
  const pathname = usePathname();
  const basePath = pathname.startsWith("/admin/workspaces/")
    ? `/admin/workspaces/${workspaceId}`
    : "/admin/settings";

  return (
    <WorkspaceSettingsFrame workspaceId={workspaceId} settings={settings}>
      {({ workspace }) => (
        <>
          <div className="flex items-center gap-3">
            <WorkspaceIcon workspace={workspace} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{workspace.name}</span>
                <WorkspaceVerificationIcon status={workspace.verification_status} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("address")}{" "}
                <span className="break-all font-mono text-foreground">
                  {`${PLATFORM_ZONE}/workspace/${workspace.slug}`}
                </span>
              </p>
            </div>
          </div>

          <WorkspaceNotListedNotice status={workspace.verification_status} />

          <SetupChecklist workspace={workspace} basePath={basePath} />
        </>
      )}
    </WorkspaceSettingsFrame>
  );
}
