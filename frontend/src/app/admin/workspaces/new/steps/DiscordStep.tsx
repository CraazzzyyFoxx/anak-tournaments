"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";

import { bindFailure } from "@/components/admin/workspace-settings/discord/errors";
import { GuildMark } from "@/components/admin/workspace-settings/discord/GuildMark";
import { ServerPicker } from "@/components/admin/workspace-settings/discord/ServerPicker";
import { userQueryKeys } from "@/lib/users/query-keys";
import workspaceService from "@/services/workspace.service";
import type { Workspace } from "@/types/workspace.types";

/**
 * Step 4: bind the community's Discord server, through the same picker as
 * Settings > Discord. Once bound, the step only names the server: the bot,
 * announcements and mixes are that section's job.
 */
export function DiscordStep({
  workspace,
  onLinked
}: Readonly<{ workspace: Workspace; onLinked: () => void }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.discord");
  const tw = useTranslations("adminWorkspace.newWorkspace.discord");
  const [error, setError] = useState<string | null>(null);

  const guildsQuery = useQuery({
    queryKey: userQueryKeys.myDiscordGuilds(),
    queryFn: () => workspaceService.myDiscordGuilds(),
    retry: false
  });

  const bind = useMutation({
    mutationFn: (guildId: string) => workspaceService.verifyDiscordGuild(workspace.id, guildId),
    onSuccess: () => {
      setError(null);
      onLinked();
    },
    onError: (cause) => setError(bindFailure(cause, t))
  });

  // Only servers this account can manage are bindable; the rest would be a
  // guaranteed 403.
  const manageable = (guildsQuery.data ?? []).filter((guild) => guild.can_manage);
  const boundId = workspace.discord_guild_id;

  if (boundId) {
    const guild = manageable.find((entry) => entry.guild_id === boundId);
    const name = guild?.name ?? "Discord";
    return (
      <div className="flex min-w-0 items-center gap-3">
        <GuildMark name={name} src={guild?.icon_url} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={name}>
            {name}
          </p>
          <p className="text-xs text-muted-foreground">{tw("linkedHelp")}</p>
        </div>
      </div>
    );
  }

  return (
    <ServerPicker
      boundId={null}
      guilds={manageable}
      loading={guildsQuery.isLoading}
      failed={guildsQuery.isError}
      pendingId={bind.isPending ? (bind.variables ?? null) : null}
      error={error}
      onBind={(guildId) => bind.mutate(guildId)}
    />
  );
}
