"use client";

import Link from "next/link";
import { AlertCircle, AlertTriangle, Info, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileGrid } from "@/components/admin/StatTile";
import type { Tone } from "@/components/admin/tone";
import { SurfaceCard, SurfaceCardContent, SurfaceCardHeader } from "./SurfaceCard";

export type AttentionTone = "critical" | "warning" | "info";

export type IssueItem = {
  label: string;
  count: number;
  href: string;
  tone: AttentionTone;
};

/**
 * How each severity reads. The row used to print the raw enum (`capitalize`d
 * `"critical"`), which told the reader nothing about urgency.
 */
const SEVERITY: Record<AttentionTone, { tone: Tone; icon: LucideIcon; detail: string }> = {
  critical: { tone: "danger", icon: AlertTriangle, detail: "Needs immediate action" },
  warning: { tone: "warning", icon: AlertCircle, detail: "Needs attention soon" },
  info: { tone: "info", icon: Info, detail: "Review when convenient" },
};

interface IssuesQueueProps {
  items: IssueItem[];
}

export function IssuesQueue({ items }: IssuesQueueProps) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg border border-border/50 bg-background/60">
              <AlertTriangle className="size-3.5 text-muted-foreground" aria-hidden />
            </div>
            <CardTitle asChild className="text-sm">
              <h2>Issues</h2>
            </CardTitle>
          </div>
          {items.length > 0 && (
            <Badge variant="destructive" className="tabular-nums">
              {items.length}
            </Badge>
          )}
        </div>
        {items.length > 0 && (
          <CardDescription className="text-xs">
            {items.length} item{items.length === 1 ? "" : "s"} need
            {items.length === 1 ? "s" : ""} attention
          </CardDescription>
        )}
      </SurfaceCardHeader>
      <SurfaceCardContent>
        {items.length > 0 ? (
          <StatTileGrid className="md:grid-cols-1 xl:grid-cols-1">
            {items.map((item) => {
              const severity = SEVERITY[item.tone];
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <StatTile
                    label={item.label}
                    value={item.count}
                    detail={severity.detail}
                    icon={severity.icon}
                    tone={severity.tone}
                    className="transition-colors hover:bg-accent/30"
                  />
                </Link>
              );
            })}
          </StatTileGrid>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing needs attention — new issues appear here as they are detected.
          </p>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
