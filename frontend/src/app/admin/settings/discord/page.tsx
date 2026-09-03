"use client";

import { CurrentWorkspaceSection } from "@/components/admin/workspace-settings/sectionMounts";

/** Discord settings of the workspace this admin is working in. */
export default function DiscordSettingsPage() {
  return <CurrentWorkspaceSection section="discord" />;
}
