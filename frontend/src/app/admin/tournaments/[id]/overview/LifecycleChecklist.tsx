"use client";

import type { ElementType } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, Lock, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ChecklistItem, ChecklistPhase, ChecklistState } from "./checklist-model";

const PHASE_TITLES: Record<ChecklistPhase, string> = {
  setup: "Setup",
  registration: "Registration",
  formation: "Team formation",
  bracket: "Bracket",
  live: "Live",
  finish: "Finish"
};

// Tone classes mirror the Setup Health tiles in TournamentSetupTab.
const STATE_META: Record<
  ChecklistState,
  { label: string; icon: ElementType; className: string }
> = {
  done: { label: "Done", icon: CheckCircle2, className: "border-primary/40 bg-primary/10 text-primary" },
  todo: { label: "To do", icon: Circle, className: "border-border/60 bg-muted/10 text-muted-foreground" },
  warn: {
    label: "Attention",
    icon: AlertTriangle,
    className: "border-amber-700/50 bg-amber-950/20 text-amber-200"
  },
  skipped: { label: "Skipped", icon: Minus, className: "border-border/60 bg-muted/10 text-muted-foreground" },
  "no-access": { label: "No access", icon: Lock, className: "border-border/60 bg-muted/10 text-muted-foreground" }
};

function ChecklistRow({ item }: Readonly<{ item: ChecklistItem }>) {
  const meta = STATE_META[item.state];
  const Icon = meta.icon;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-b-0">
      <div className="min-w-0">
        {item.href && item.state !== "no-access" ? (
          <Link href={item.href} className="text-sm hover:underline">
            {item.label}
          </Link>
        ) : (
          <span className="text-sm">{item.label}</span>
        )}
        {item.detail ? (
          <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
        ) : null}
      </div>
      <Badge variant="outline" className={cn("shrink-0 gap-1", meta.className)}>
        <Icon className="size-3" />
        {meta.label}
      </Badge>
    </div>
  );
}

/**
 * Living checklist of the Overview tab (§3, D22). Items come pre-computed
 * from `buildChecklist`; groups without applicable items are omitted.
 */
export function LifecycleChecklist({
  items,
  isLoading
}: Readonly<{ items: ChecklistItem[]; isLoading: boolean }>) {
  const groups = (Object.keys(PHASE_TITLES) as ChecklistPhase[])
    .map((phase) => ({ phase, rows: items.filter((item) => item.phase === phase) }))
    .filter((group) => group.rows.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle checklist</CardTitle>
        <CardDescription>
          What the tournament still needs on its way to completion.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <section key={group.phase}>
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {PHASE_TITLES[group.phase]}
                </h3>
                <div className="mt-1">
                  {group.rows.map((item) => (
                    <ChecklistRow key={item.key} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
