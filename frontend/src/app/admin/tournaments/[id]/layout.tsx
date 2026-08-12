import type { ReactNode } from "react";

import { TournamentHubShell } from "./TournamentHubShell";

export default async function AdminTournamentHubLayout({
  children,
  params
}: Readonly<{
  children: ReactNode;
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;
  return <TournamentHubShell tournamentId={Number(id)}>{children}</TournamentHubShell>;
}
