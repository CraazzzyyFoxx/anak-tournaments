"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { BarChart3, Calendar, Trophy, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { title: "Teams", icon: Users, tab: "teams" },
  { title: "Matches", icon: Calendar, tab: "matches" },
  { title: "Heroes", icon: Trophy, tab: "heroes" },
  { title: "Standings", icon: BarChart3, tab: "standings" }
] as const;

type TabId = (typeof items)[number]["tab"];

const normalizeSegment = (segment: string | null): TabId => {
  if (items.some((item) => item.tab === segment)) return segment as TabId;
  return "teams";
};

type TournamentSectionNavProps = {
  tournamentId: string;
  variant: "desktop" | "mobile";
  className?: string;
};

export default function TournamentSectionNav({
  tournamentId,
  variant,
  className
}: TournamentSectionNavProps) {
  const segment = useSelectedLayoutSegment();
  const activeTab = normalizeSegment(segment);
  const searchParams = useSearchParams();

  const buildHref = (tab: TabId) => {
    const base = tab === "teams"
      ? `/tournaments/${tournamentId}`
      : `/tournaments/${tournamentId}/${tab}`;
    if (tab === "matches" && activeTab === "matches") {
      const qs = searchParams.toString();
      return qs ? `${base}?${qs}` : base;
    }
    return base;
  };

  if (variant === "mobile") {
    return (
      <nav aria-label="Tournament sections" className={cn("flex gap-2 overflow-x-auto pb-1", className)}>
        {items.map((item) => {
          const isActive = item.tab === activeTab;
          const Icon = item.icon;
          return (
            <Link
              key={item.tab}
              href={buildHref(item.tab)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
                isActive
                  ? "border-white/[0.12] bg-white/[0.08] text-white"
                  : "border-white/[0.07] bg-white/[0.02] text-white/50 hover:bg-white/[0.05] hover:text-white/80"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="whitespace-nowrap">{item.title}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Tournament sections" className={cn("flex flex-col gap-0.5", className)}>
      {items.map((item) => {
        const isActive = item.tab === activeTab;
        const Icon = item.icon;
        return (
          <Link
            key={item.tab}
            href={buildHref(item.tab)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              isActive
                ? "bg-white/[0.07] text-white"
                : "text-white/50 hover:bg-white/[0.04] hover:text-white/80"
            )}
          >
            <Icon className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              isActive ? "text-white" : "text-white/35 group-hover:text-white/60"
            )} />
            <span className="truncate">{item.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
