import React from "react";
import { useDiscordChannels } from "@/hooks/useDiscordEntities";
import { DiscordChannel } from "@/types/discord.types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw, Code2, Hash } from "lucide-react";

export interface DiscordChannelSelectProps {
  workspaceId: number | null | undefined;
  value: string;
  onChange: (channelId: string) => void;
  onChannelNameSelected?: (channelName: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function DiscordChannelSelect({
  workspaceId,
  value,
  onChange,
  onChannelNameSelected,
  disabled,
  placeholder = "Select Discord channel...",
  className,
}: DiscordChannelSelectProps) {
  const { data, isLoading, refetch } = useDiscordChannels(workspaceId);
  const [manualMode, setManualMode] = React.useState(false);

  const channels: DiscordChannel[] = data?.channels ?? [];
  const hasChannels = channels.length > 0;

  // Group channels by category
  const categories = React.useMemo(() => {
    const grouped = new Map<string, DiscordChannel[]>();
    for (const ch of channels) {
      const cat = ch.category_name || "Uncategorized";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(ch);
    }
    return Array.from(grouped.entries());
  }, [channels]);

  const handleSelectChannel = (selectedChannelId: string) => {
    onChange(selectedChannelId);
    if (onChannelNameSelected) {
      const selectedChannel = channels.find((c) => c.id === selectedChannelId);
      if (selectedChannel) {
        onChannelNameSelected(selectedChannel.name);
      }
    }
  };

  if (manualMode || (!isLoading && !hasChannels)) {
    return (
      <div className="flex items-center gap-1.5 w-full">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="123456789012345678"
          maxLength={19}
          className={className}
        />
        {hasChannels && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => setManualMode(false)}
            title="Switch back to channel dropdown"
          >
            Dropdown
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 w-full">
      <Select
        value={value}
        onValueChange={handleSelectChannel}
        disabled={disabled || isLoading}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder={isLoading ? "Loading channels..." : placeholder}>
            {(() => {
              const matched = channels.find((c) => c.id === value);
              if (matched) {
                return (
                  <div className="flex items-center gap-1.5 truncate">
                    <Hash className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{matched.name}</span>
                  </div>
                );
              }
              return value ? <span className="font-mono text-xs">{value}</span> : null;
            })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {categories.map(([categoryName, chs]) => (
            <SelectGroup key={categoryName}>
              <SelectLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                {categoryName}
              </SelectLabel>
              {chs.map((ch) => (
                <SelectItem key={ch.id} value={ch.id}>
                  <div className="flex items-center gap-1.5">
                    <Hash className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium">{ch.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => refetch()}
        disabled={isLoading}
        title="Refresh channels from Discord"
      >
        <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => setManualMode(true)}
        title="Enter Channel ID manually"
      >
        <Code2 className="size-3.5" />
      </Button>
    </div>
  );
}
