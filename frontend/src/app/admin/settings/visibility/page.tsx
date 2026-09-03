"use client";

import { CurrentWorkspaceSection } from "@/components/admin/workspace-settings/sectionMounts";

/** Visibility settings of the workspace this admin is working in. */
export default function VisibilitySettingsPage() {
  return <CurrentWorkspaceSection section="visibility" />;
}
