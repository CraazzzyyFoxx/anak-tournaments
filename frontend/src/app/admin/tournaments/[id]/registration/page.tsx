import { redirect } from "next/navigation";

import { withSearch } from "../containerIndex";

/** `/registration` is a container, not a view: its content is the entries sub-tab. */
export default async function RegistrationIndexPage({
  params,
  searchParams
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { id } = await params;
  redirect(withSearch(`/admin/tournaments/${id}/registration/entries`, await searchParams));
}
