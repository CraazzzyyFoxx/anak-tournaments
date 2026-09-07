"use client";

import { CurrentWorkspaceSection } from "@/components/admin/workspace-settings/sectionMounts";

/** Domain settings of the workspace this admin is working in. */
export default function DomainSettingsPage() {
  return <CurrentWorkspaceSection section="domain" />;
}
