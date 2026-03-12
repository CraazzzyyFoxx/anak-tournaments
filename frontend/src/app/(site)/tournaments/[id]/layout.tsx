import React from "react";
import type { Metadata } from "next";

import { Activity, Calendar, ExternalLink, Users } from "lucide-react";

import { Breadcrumb } from "@/components/Breadcrumb";
import { TournamentChallongeLinkInline } from "@/app/(site)/tournaments/components/TournamentCard";
import { cn, formatDateRange } from "@/lib/utils";

import TournamentSectionNav from "./_components/TournamentSectionNav";
import { getTournament } from "./_data";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const tournamentId = Number(params.id);

  try {
    const tournament = await getTournament(tournamentId);
    const title = `${tournament.name} | AQT`;

    return {
      title,
      description: `Overview for ${tournament.name} on AQT.`,
      openGraph: {
        title,
        description: `Overview for ${tournament.name} on AQT.`,
        url: `https://aqt.craazzzyyfoxx.me/tournaments/${tournamentId}`,
        type: "website",
        siteName: "AQT",
        locale: "en_US"
      }
    };
  } catch {
    return {
      title: "Tournament | AQT",
      description: "Tournament overview on AQT."
    };
  }
}

export default async function TournamentLayout({
  children,
  params
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}>) {
  const resolvedParams = await params;
  const tournamentId = Number(resolvedParams.id);
  const tournament = await getTournament(tournamentId);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
      {/* Sidebar */}
      <aside className="hidden md:block">
        <div className="sticky top-20">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2">
            <TournamentSectionNav tournamentId={resolvedParams.id} variant="desktop" />
          </div>
        </div>
      </aside>

      <div className="min-w-0 space-y-5">
        <Breadcrumb
          items={[
            { label: "Tournaments", href: "/tournaments" },
            { label: tournament.name }
          ]}
        />
          {/* Tournament header */}
          <div className={cn(
            "rounded-xl border border-white/[0.07] bg-white/[0.02] p-6",
            tournament.is_league && "border-l-2 border-l-purple-500/50"
          )}>
            {/* Tags row */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {!tournament.is_league && (
                <span className="text-xs tabular-nums text-white/40 font-mono">
                  #{tournament.number}
                </span>
              )}
              {tournament.is_league && (
                <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/20 tracking-wide uppercase">
                  League
                </span>
              )}
              <span className={cn(
                "inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide",
                tournament.is_finished ? "text-white/40" : "text-emerald-400"
              )}>
                {!tournament.is_finished && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
                {tournament.is_finished ? "Finished" : "Live"}
              </span>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {tournament.name}
            </h1>

            {tournament.description && (
              <p className="mt-2 text-sm leading-relaxed text-white/50 max-w-prose">
                {tournament.description}
              </p>
            )}

            {/* Meta tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
              <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <Calendar className="h-4 w-4 shrink-0 text-white/30" />
                <div className="min-w-0">
                  <div className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Dates</div>
                  <div className="truncate text-sm font-medium text-white/80">
                    {formatDateRange(tournament.start_date, tournament.end_date)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <Users className="h-4 w-4 shrink-0 text-white/30" />
                <div className="min-w-0">
                  <div className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Participants</div>
                  <div className="truncate text-sm font-medium text-white/80">
                    {tournament.participants_count ?? 0}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <Activity className="h-4 w-4 shrink-0 text-white/30" />
                <div className="min-w-0">
                  <div className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Status</div>
                  <div className={cn(
                    "text-sm font-medium",
                    tournament.is_finished ? "text-white/60" : "text-emerald-400"
                  )}>
                    {tournament.is_finished ? "Finished" : "Ongoing"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <ExternalLink className="h-4 w-4 shrink-0 text-white/30" />
                <div className="min-w-0">
                  <div className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Bracket</div>
                  <TournamentChallongeLinkInline tournament={tournament} />
                </div>
              </div>
            </div>
          </div>

          {/* Mobile nav */}
          <div className="md:hidden">
            <TournamentSectionNav tournamentId={resolvedParams.id} variant="mobile" />
          </div>

          <section className="min-w-0">{children}</section>
        </div>
      </div>
  );
}
