"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EYEBROW_CLASS } from "@/components/admin/tone";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace.store";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface GreetingBarProps {
  canCreateTournament?: boolean;
}

export function GreetingBar({ canCreateTournament }: GreetingBarProps) {
  const { user } = useAuthProfile();
  const { workspaces, currentWorkspaceId } = useWorkspaceStore();
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);

  const greeting = getGreeting();
  const displayName = user?.username ?? "Admin";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium text-foreground">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {greeting}, {displayName} · <span className="tabular-nums">{today}</span>
          </p>
        </div>
        {currentWorkspace && (
          <Badge
            variant="outline"
            className={cn(EYEBROW_CLASS, "shrink-0 rounded-full px-2.5 py-0.5")}
          >
            {currentWorkspace.name}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {canCreateTournament && (
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/tournaments/new">
              <Plus className="size-3.5" aria-hidden />
              Create tournament
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
