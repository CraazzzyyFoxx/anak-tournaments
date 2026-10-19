import type { ReactNode } from "react";

import { WORKSPACE_RECORD_SECTIONS } from "@/components/admin/workspace-settings/sections";
import { WorkspaceSettingsShell } from "@/components/admin/workspace-settings/WorkspaceSettingsShell";

/**
 * The same settings hub, scoped to a workspace named in the route: a superuser
 * editing someone else's workspace rather than their own.
 *
 * The rail is narrowed to the sections that exist under both shells. Divisions,
 * statuses, sub-roles and subscriptions are workspace-scoped screens of their
 * own and route only under `/admin/settings`, so listing them here would be a
 * 404 dressed up as navigation.
 */
export default async function WorkspaceScopedSettingsLayout({
  params,
  children
}: Readonly<{ params: Promise<{ id: string }>; children: ReactNode }>) {
  const { id } = await params;

  return (
    <WorkspaceSettingsShell basePath={`/admin/workspaces/${id}`} sections={WORKSPACE_RECORD_SECTIONS}>
      {children}
    </WorkspaceSettingsShell>
  );
}
