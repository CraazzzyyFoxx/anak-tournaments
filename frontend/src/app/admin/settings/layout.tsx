import type { ReactNode } from "react";

import { WorkspaceSettingsShell } from "@/components/admin/workspace-settings/WorkspaceSettingsShell";

/**
 * The workspace settings hub (T5, F11 ·1).
 *
 * Scope is implicit: every section reads `currentWorkspaceId` from the
 * workspace store, the same selection the shell header shows, so the hub never
 * carries a workspace id in its URL and a link to `/admin/settings/branding`
 * means "brand the workspace I am in".
 */
export default function WorkspaceSettingsLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  return <WorkspaceSettingsShell basePath="/admin/settings">{children}</WorkspaceSettingsShell>;
}
