import { redirect } from "next/navigation";

export default async function AdminTournamentWorkspacePage({
  params
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  redirect(`/admin/tournaments/${id}/overview`);
}
