"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import {
  BarChart3,
  Calendar,
  ClipboardList,
  GitBranch,
  Trophy,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Stage, TournamentStatus } from "@/types/tournament.types";

const baseItems = [
  { title: "Teams", icon: Users, tab: "teams" },
  { title: "Participants", icon: ClipboardList, tab: "participants" },
  { title: "Matches", icon: Calendar, tab: "matches" },
  { title: "Heroes", icon: Trophy, tab: "heroes" },
  { title: "Standings", icon: BarChart3, tab: "standings" },
] as const;

const phaseLockedTabs = new Set<(typeof baseItems)[number]["tab"]>([
  "teams",
  "matches",
  "heroes",
  "standings",
]);
const unlockedStatuses = new Set<TournamentStatus>(["live", "playoffs", "completed"]);

type TabId = (typeof baseItems)[number]["tab"] | "bracket";

type NavEntry = {
  key: string;
  href: string;
  label: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
};

const normalizeSegment = (segment: string | null): TabId => {
  if (segment === "bracket") {
    return "bracket";
  }

  if (baseItems.some((item) => item.tab === segment)) {
    return segment as TabId;
  }

  return "teams";
};

type TournamentSectionNavProps = {
  tournamentId: string;
  status: TournamentStatus;
  stages?: Stage[];
  variant: "desktop" | "mobile";
  className?: string;
};

export default function TournamentSectionNav({
  tournamentId,
  status,
  stages = [],
  variant,
  className,
}: TournamentSectionNavProps) {
  const segment = useSelectedLayoutSegment();
  const activeTab = normalizeSegment(segment);
  const searchParams = useSearchParams();
  const stageParam = searchParams.get("stage");
  const viewParam = searchParams.get("view");

  const groupStages = stages.filter(
    (stage) => stage.stage_type === "round_robin" || stage.stage_type === "swiss"
  );
  const eliminationStages = stages.filter(
    (stage) =>
      stage.stage_type === "single_elimination" ||
      stage.stage_type === "double_elimination"
  );
  const fallbackStage = eliminationStages[0] ?? stages[0];
  const activeStageId = stageParam ? Number(stageParam) : fallbackStage?.id;
  const isGroupViewActive =
    activeTab === "bracket" &&
    (viewParam === "groups" ||
      (!!activeStageId && groupStages.some((stage) => stage.id === activeStageId)));
  const areCompetitionTabsEnabled = unlockedStatuses.has(status);

  const bracketEntries: NavEntry[] = [];

  if (groupStages.length > 1) {
    bracketEntries.push({
      key: "group-stage",
      href: `/tournaments/${tournamentId}/bracket?view=groups`,
      label: "Group Stage",
      subtitle: `${groupStages.length} groups`,
      icon: GitBranch,
      isActive: isGroupViewActive,
    });
  } else if (groupStages.length === 1) {
    const stage = groupStages[0];
    bracketEntries.push({
      key: `stage-${stage.id}`,
      href: `/tournaments/${tournamentId}/bracket?stage=${stage.id}`,
      label: stage.name,
      subtitle: stage.stage_type.replace(/_/g, " "),
      icon: GitBranch,
      isActive: activeTab === "bracket" && stage.id === activeStageId,
    });
  }

  eliminationStages.forEach((stage) => {
    bracketEntries.push({
      key: `stage-${stage.id}`,
      href: `/tournaments/${tournamentId}/bracket?stage=${stage.id}`,
      label:
        eliminationStages.length === 1 && groupStages.length > 0
          ? "Playoffs"
          : stage.name,
      subtitle: stage.stage_type.replace(/_/g, " "),
      icon: GitBranch,
      isActive:
        activeTab === "bracket" && viewParam !== "groups" && stage.id === activeStageId,
    });
  });

  const buildHref = (tab: typeof baseItems[number]["tab"]) => {
    const base =
      tab === "teams"
        ? `/tournaments/${tournamentId}`
        : `/tournaments/${tournamentId}/${tab}`;

    if (tab === "matches" && activeTab === "matches") {
      const qs = searchParams.toString();
      return qs ? `${base}?${qs}` : base;
    }

    return base;
  };

  const isItemDisabled = (tab: typeof baseItems[number]["tab"]) =>
    phaseLockedTabs.has(tab) && !areCompetitionTabsEnabled;

  if (variant === "mobile") {
    return (
      <div className={cn("space-y-2", className)}>
        <nav aria-label="Tournament sections" className="flex gap-2 overflow-x-auto pb-1">
          {[...bracketEntries, ...baseItems].map((item) => {
            const isBracketEntry = "href" in item;
            const isActive = isBracketEntry ? item.isActive : item.tab === activeTab;
            const isDisabled = !isBracketEntry && isItemDisabled(item.tab);
            const href = isBracketEntry ? item.href : buildHref(item.tab);
            const Icon = item.icon;
            const key = "key" in item ? item.key : item.tab;
            const itemClassName = cn(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors",
              isDisabled
                ? "cursor-not-allowed border-white/[0.05] bg-white/[0.01] text-white/25"
                : isActive
                  ? "border-white/[0.12] bg-white/[0.08] text-white"
                  : "border-white/[0.07] bg-white/[0.02] text-white/50 hover:bg-white/[0.05] hover:text-white/80"
            );
            const content = (
              <>
                <Icon className={cn("h-4 w-4", isDisabled && "text-white/20")} />
                <span className="whitespace-nowrap">{"label" in item ? item.label : item.title}</span>
              </>
            );

            if (isDisabled) {
              return (
                <div
                  key={key}
                  aria-disabled="true"
                  className={itemClassName}
                >
                  {content}
                </div>
              );
            }

            return (
              <Link
                key={key}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={itemClassName}
              >
                {content}
              </Link>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <nav aria-label="Tournament sections" className={cn("flex flex-col gap-0.5", className)}>
      {[...bracketEntries, ...baseItems].map((item) => {
        const isBracketEntry = "href" in item;
        const isActive = isBracketEntry ? item.isActive : item.tab === activeTab;
        const isDisabled = !isBracketEntry && isItemDisabled(item.tab);
        const href = isBracketEntry ? item.href : buildHref(item.tab);
        const Icon = item.icon;
        const subtitle = isBracketEntry ? item.subtitle : undefined;
        const key = "key" in item ? item.key : item.tab;
        const itemClassName = cn(
          "group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isDisabled
            ? "cursor-not-allowed text-white/25"
            : isActive
              ? "bg-white/[0.07] text-white"
              : "text-white/50 hover:bg-white/[0.04] hover:text-white/80"
        );
        const content = (
          <>
            <Icon
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                isDisabled
                  ? "text-white/20"
                  : isActive
                    ? "text-white"
                    : "text-white/35 group-hover:text-white/60"
              )}
            />
            <div className="min-w-0 flex-1">
              <span className="block truncate">{"label" in item ? item.label : item.title}</span>
              {subtitle && (
                <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.18em] text-white/30">
                  {subtitle}
                </span>
              )}
            </div>
          </>
        );

        if (isDisabled) {
          return (
            <div
              key={key}
              aria-disabled="true"
              className={itemClassName}
            >
              {content}
            </div>
          );
        }

        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={itemClassName}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
