"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useFormatter } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAuthProfile } from "@/hooks/useAuthProfile";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface GreetingBarProps {
  canCreateTournament?: boolean;
}

export function GreetingBar({ canCreateTournament }: Readonly<GreetingBarProps>) {
  const { user } = useAuthProfile();
  const format = useFormatter();

  const greeting = getGreeting();
  const displayName = user?.username ?? "Admin";
  const today = format.dateTime(new Date(), {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-medium text-foreground">Dashboard</h1>
        <p className="text-xs text-muted-foreground">
          {greeting}, {displayName} · <span className="tabular-nums">{today}</span>
        </p>
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
