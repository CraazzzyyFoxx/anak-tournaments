import { redirect } from "next/navigation";

import { withSearch } from "../containerIndex";

/** `/matches` is a container, not a view: its content is the encounters sub-tab. */
export default async function MatchesIndexPage({
  params,
  searchParams
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { id } = await params;
  redirect(withSearch(`/admin/tournaments/${id}/matches/encounters`, await searchParams));
}
