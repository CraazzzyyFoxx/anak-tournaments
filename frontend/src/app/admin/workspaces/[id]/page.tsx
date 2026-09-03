import { redirect } from "next/navigation";

/** The hub root is not a screen: the rail's first section is. */
export default async function WorkspaceSettingsIndex({
  params
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  redirect(`/admin/workspaces/${id}/general`);
}
