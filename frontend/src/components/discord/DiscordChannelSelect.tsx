"use client";

import React from "react";
import { Code2, Hash, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { AdminCombobox, AdminComboboxCheck } from "@/components/admin/AdminCombobox";
import { Button } from "@/components/ui/button";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { useDiscordChannels } from "@/hooks/useDiscordEntities";
import { cn } from "@/lib/utils";
import { DiscordChannel } from "@/types/discord.types";

export interface DiscordChannelSelectProps {
  workspaceId: number | null | undefined;
  value: string;
  onChange: (channelId: string) => void;
  onChannelNameSelected?: (channelName: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Accessible name for the manual ID field, which has no visible label. */
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
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const channels: DiscordChannel[] = data?.channels ?? [];
  const hasChannels = channels.length > 0;
  const selected = channels.find((channel) => channel.id === value);

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

  const pick = (channel: DiscordChannel) => {
    onChange(channel.id);
    onChannelNameSelected?.(channel.name);
    setOpen(false);
    setSearch("");
  };

  // `className` lands on the WRAPPER, not the trigger: this renders a row --
  // control plus one or two buttons -- into the caller's layout, so the wrapper
  // is what has to carry their width. Same contract as `DiscordRoleSelect`.
  //
  // Manual entry is the only way out when our bot cannot read the guild, so it
  // stays reachable -- but it is the fallback, never the advertised workflow.
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
      <AdminCombobox
        id={id}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled || isLoading}
        triggerClassName="h-9 min-w-0 border-input bg-transparent hover:bg-transparent"
        // The trigger names itself from its content: the chosen channel once
        // there is one, the purpose while there is not.
        label={
          selected ? (
            <span className="flex items-center gap-1.5 truncate">
              <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : value ? (
            // A stored channel the guild no longer returns: the id is all we know.
            <span className="font-mono text-xs">{value}</span>
          ) : isLoading ? (
            t("loading")
          ) : (
            (placeholder ?? t("placeholder"))
          )
        }
        labelTitle={selected?.name ?? value ?? undefined}
        searchValue={search}
        onSearchValueChange={setSearch}
        searchPlaceholder={t("searchPlaceholder")}
        searchLabel={t("searchLabel")}
        emptyMessage={t("empty")}
      >
        {categories.map(([categoryName, categoryChannels]) => (
          <CommandGroup key={categoryName} heading={categoryName}>
            {categoryChannels.map((channel) => (
              // The id joins the search text so a pasted snowflake still finds it.
              <CommandItem
                key={channel.id}
                value={`${channel.name} ${channel.id}`}
                onSelect={() => pick(channel)}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{channel.name}</span>
                </span>
                <AdminComboboxCheck selected={channel.id === value} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </AdminCombobox>
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
