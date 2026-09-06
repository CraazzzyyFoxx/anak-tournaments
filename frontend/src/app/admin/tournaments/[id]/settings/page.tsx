import { redirect } from "next/navigation";

import { withSearch } from "../containerIndex";

/** `/settings` is a container, not a section: its content is General. */
export default async function SettingsIndexPage({
  params,
  searchParams
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { id } = await params;
  redirect(withSearch(`/admin/tournaments/${id}/settings/general`, await searchParams));
}
