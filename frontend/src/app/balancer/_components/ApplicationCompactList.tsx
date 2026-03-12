"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BalancerApplication } from "@/types/balancer-admin.types";

type ApplicationCompactListProps = {
  applications: BalancerApplication[];
  editingPlayerId?: number | null;
  onSelectPlayer?: (playerId: number | null) => void;
  maxHeightClassName?: string;
};

export function ApplicationCompactList({
  applications,
  editingPlayerId,
  onSelectPlayer,
  maxHeightClassName = "max-h-[32rem]",
}: ApplicationCompactListProps) {
  return (
    <ScrollArea className={maxHeightClassName}>
      <div className="space-y-2 pr-3">
        {applications.map((application) => {
          const roles = [application.primary_role, ...application.additional_roles_json].filter(Boolean).join(" / ");
          const isEditing = application.player?.id != null && application.player.id === editingPlayerId;
          const isClickable = application.player != null && onSelectPlayer != null;
          return (
            <Card
              key={application.id}
              className={cn(
                "border-border/60 bg-background/70 transition-colors",
                isEditing && "border-primary/50 bg-primary/5 ring-1 ring-primary/30",
                isClickable && "cursor-pointer hover:border-primary/30",
              )}
              onClick={isClickable ? () => onSelectPlayer(isEditing ? null : application.player!.id) : undefined}
            >
              <CardContent className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{application.battle_tag}</div>
                    <div className="truncate text-xs text-muted-foreground">{roles || "No mapped roles"}</div>
                  </div>
                  {application.player ? <Badge>In pool</Badge> : application.is_active ? <Badge variant="outline">Ready</Badge> : <Badge variant="secondary">Archived</Badge>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {application.discord_nick ?? application.twitch_nick ?? application.last_tournament_text ?? "No extra info"}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}
