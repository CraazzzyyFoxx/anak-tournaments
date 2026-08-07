import React from "react";
import { useDiscordGuildInfo } from "@/hooks/useDiscordEntities";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CheckCircle2, XCircle, Users, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DiscordServerStatus({
  workspaceId,
  className,
}: {
  workspaceId: number | null | undefined;
  className?: string;
}) {
  const { data, isLoading, refetch } = useDiscordGuildInfo(workspaceId);

  if (!workspaceId) return null;

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
        <RefreshCw className="size-3.5 animate-spin" />
        <span>Checking Discord bot status...</span>
      </div>
    );
  }

  const isConnected = data?.connected ?? false;

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border bg-card text-card-foreground text-sm ${className}`}>
      <div className="flex items-center gap-3">
        <Avatar className="size-8 rounded-full border">
          {data?.icon_url ? <AvatarImage src={data.icon_url} alt={data.name || "Discord Guild"} /> : null}
          <AvatarFallback className="text-xs bg-muted">DC</AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-2 font-medium">
            <span>{data?.name || "Discord Server"}</span>
            {isConnected ? (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-emerald-500/30 text-emerald-500 bg-emerald-500/10">
                <CheckCircle2 className="size-3 mr-1" />
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-destructive/30 text-destructive bg-destructive/10">
                <XCircle className="size-3 mr-1" />
                Not Connected
              </Badge>
            )}
          </div>
          {data?.member_count ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <Users className="size-3" />
              <span>{data.member_count} members</span>
            </div>
          ) : null}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        onClick={() => refetch()}
        title="Refresh status"
      >
        <RefreshCw className="size-3.5" />
      </Button>
    </div>
  );
}
