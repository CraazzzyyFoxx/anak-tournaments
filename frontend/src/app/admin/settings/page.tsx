"use client";

import { CurrentWorkspaceSection } from "@/components/admin/workspace-settings/sectionMounts";

/** Overview of the workspace this admin is working in: identity and setup checklist. */
export default function WorkspaceOverviewPage() {
  return <CurrentWorkspaceSection section="overview" />;
}
