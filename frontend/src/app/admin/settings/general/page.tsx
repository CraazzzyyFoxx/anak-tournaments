"use client";

import { CurrentWorkspaceSection } from "@/components/admin/workspace-settings/sectionMounts";

/** General settings of the workspace this admin is working in. */
export default function GeneralSettingsPage() {
  return <CurrentWorkspaceSection section="general" />;
}
