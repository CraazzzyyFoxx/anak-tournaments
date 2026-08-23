import { redirect } from "next/navigation";

export default async function LegacyTournamentDraftRoute({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/draft/${slug}`);
}
