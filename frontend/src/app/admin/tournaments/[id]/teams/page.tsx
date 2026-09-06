import { redirect } from "next/navigation";

import { withSearch } from "../containerIndex";

/** `/teams` is a container, not a view: its content is the roster sub-tab. */
export default async function TeamsIndexPage({
  params,
  searchParams
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { id } = await params;
  redirect(withSearch(`/admin/tournaments/${id}/teams/roster`, await searchParams));
}
