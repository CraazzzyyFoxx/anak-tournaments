"use client";

import React from "react";
import { Code2, Hash, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

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
import { cn } from "@/lib/utils";

export interface DiscordChannelSelectProps {
  workspaceId: number | null | undefined;
  value: string;
  onChange: (channelId: string) => void;
  onChannelNameSelected?: (channelName: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Accessible name for the control, when no visible `<label for>` names it. */
  ariaLabel?: string;
  /** Id of the visible label, when there is one. */
  id?: string;
  className?: string;
}

export function DiscordChannelSelect({
  workspaceId,
  value,
  onChange,
  onChannelNameSelected,
  disabled,
  placeholder,
  ariaLabel,
  id,
  className,
}: DiscordChannelSelectProps) {
  const t = useTranslations("discord.channel");
  const { data, isLoading, refetch } = useDiscordChannels(workspaceId);
  const [manualMode, setManualMode] = React.useState(false);

  const channels: DiscordChannel[] = data?.channels ?? [];
  const hasChannels = channels.length > 0;

  const categories = React.useMemo(() => {
    const grouped = new Map<string, DiscordChannel[]>();
    for (const channel of channels) {
      const category = channel.category_name || t("uncategorized");
      const bucket = grouped.get(category);
      if (bucket) bucket.push(channel);
      else grouped.set(category, [channel]);
    }
    return [...grouped];
  }, [channels, t]);

  const handleSelectChannel = (selectedChannelId: string) => {
    onChange(selectedChannelId);
    const selected = channels.find((channel) => channel.id === selectedChannelId);
    if (selected) onChannelNameSelected?.(selected.name);
  };

  // `className` lands on the WRAPPER, not the trigger: this renders a row —
  // control plus one or two buttons — into the caller's layout, so the wrapper
  // is what has to carry their width. Same contract as `DiscordRoleSelect`.
  //
  // Manual entry is the only way out when our bot cannot read the guild, so it
  // stays reachable — but it is the fallback, never the advertised workflow.
  if (manualMode || (!isLoading && !hasChannels)) {
    return (
      <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
          disabled={disabled}
          aria-label={ariaLabel ?? t("idAria")}
          placeholder="123456789012345678"
          inputMode="numeric"
          autoComplete="off"
          maxLength={19}
          className="w-full min-w-0 font-mono"
        />
        {hasChannels && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 px-2 text-xs"
            onClick={() => setManualMode(false)}
          >
            {t("dropdown")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <Select value={value} onValueChange={handleSelectChannel} disabled={disabled || isLoading}>
        <SelectTrigger id={id} className="w-full min-w-0" aria-label={ariaLabel}>
          <SelectValue placeholder={isLoading ? t("loading") : (placeholder ?? t("placeholder"))}>
            {(() => {
              const matched = channels.find((channel) => channel.id === value);
              if (matched) {
                return (
                  <span className="flex items-center gap-1.5 truncate">
                    <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{matched.name}</span>
                  </span>
                );
              }
              return value ? <span className="font-mono text-xs">{value}</span> : null;
            })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {categories.map(([categoryName, categoryChannels]) => (
            <SelectGroup key={categoryName}>
              <SelectLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                {categoryName}
              </SelectLabel>
              {categoryChannels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  <span className="flex items-center gap-1.5">
                    <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{channel.name}</span>
                  </span>
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
        className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => refetch()}
        disabled={isLoading}
        aria-label={t("refresh")}
        title={t("refresh")}
      >
        <RefreshCw
          aria-hidden
          className={cn("size-3.5", isLoading && "animate-spin motion-reduce:animate-none")}
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => setManualMode(true)}
        aria-label={t("manual")}
        title={t("manual")}
      >
        <Code2 aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}
