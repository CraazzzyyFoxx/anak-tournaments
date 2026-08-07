import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface DiscordRoleBadgeProps {
  name: string;
  color?: string | null;
  roleId?: string;
  className?: string;
}

export function DiscordRoleBadge({
  name,
  color,
  roleId,
  className,
}: DiscordRoleBadgeProps) {
  const badgeColor = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : null;

  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium border-border/60 bg-muted/30 text-foreground",
        className
      )}
      title={roleId ? `Role ID: ${roleId}` : undefined}
    >
      <span
        className="size-2 rounded-full shrink-0"
        style={{
          backgroundColor: badgeColor ?? "#a1a1aa",
        }}
        aria-hidden
      />
      <span className="truncate">{name}</span>
    </Badge>
  );
}
