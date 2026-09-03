import { redirect } from "next/navigation";

/** The hub root is not a screen: the rail's first section is. */
export default function WorkspaceSettingsIndex() {
  redirect("/admin/settings/general");
}
