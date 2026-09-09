"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle, LoaderCircle } from "lucide-react";

import { StatusPill } from "@/components/admin/kit/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EYEBROW_CLASS } from "@/components/admin/tone";
import { ApiError, getApiErrorMessage } from "@/lib/api-error";
import { notify } from "@/lib/notify";
import workspaceService from "@/services/workspace.service";
import { WorkspaceSettingsFrame } from "./WorkspaceSettingsFrame";
import { useWorkspaceSettingsForm } from "./useWorkspaceSettingsForm";

/**
 * The three ways a bind can fail, in the organiser's words.
 *
 * They are genuinely different situations — one is about this account, one is
 * about another workspace, one is about Discord being down — and a single
 * "could not link" toast would send the reader looking in the wrong place for
 * all three. The backend answers 403/409/503 exactly (`verify_discord_guild`),
 * so the status IS the distinction.
 */
const BIND_FAILURES: Record<number, string> = {
  403: "Discord says you no longer administer that server. Ask its owner for Manage Server (or ownership), then try again.",
  409: "Another workspace has already claimed that server. A Discord server belongs to one workspace — ask the platform admins to release it first.",
  503: "Discord could not be reached, so nothing was linked. Try again in a moment."
};

function bindFailure(error: unknown): string {
  const status = error instanceof ApiError ? error.status : 0;
  return BIND_FAILURES[status] ?? getApiErrorMessage(error, "Could not link that Discord server.");
}

/**
 * The one Discord guild a workspace runs in: patron roles and match-log channels alike.
 *
 * A picker over the servers this account administers, never a free-text ID:
 * binding a guild proves ownership through Discord OAuth server-side, so the
 * guild is not a field the workspace PATCH can set at all. Typing a snowflake
 * you do not administer could only ever produce a 403.
 */
export function DiscordSection({ workspaceId }: Readonly<{ workspaceId: number | null }>) {
  const settings = useWorkspaceSettingsForm(workspaceId, "discord");
  const { invalidate } = settings;
  const [error, setError] = useState<string | null>(null);

  const guildsQuery = useQuery({
    queryKey: ["me", "discord-guilds"],
    queryFn: () => workspaceService.myDiscordGuilds(),
    retry: false
  });

  const bind = useMutation({
    mutationFn: (guildId: string) =>
      workspaceService.verifyDiscordGuild(workspaceId as number, guildId),
    onSuccess: () => {
      setError(null);
      invalidate();
      notify.success("Discord server linked");
    },
    onError: (cause) => {
      setError(bindFailure(cause));
      notify.apiError(cause, { title: "Could not link that Discord server" });
    }
  });

  // Discord reports every server the account is in; only the ones it can
  // manage are bindable, and offering the rest would be offering a guaranteed
  // 403.
  const manageable = (guildsQuery.data ?? []).filter((guild) => guild.can_manage);

  return (
    <WorkspaceSettingsFrame workspaceId={workspaceId} settings={settings}>
      {({ workspace }) => {
        const boundId = workspace.discord_guild_id;
        const boundName = manageable.find((guild) => guild.guild_id === boundId)?.name;

        return (
          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <div>
                <p className={EYEBROW_CLASS}>Linked server</p>
                {boundId ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{boundName ?? "Discord server"}</span>
                    <span className="font-mono text-xs text-muted-foreground">{boundId}</span>
                    {workspace.discord_guild_verified_at ? (
                      <StatusPill tone="success">
                        <CheckCircle aria-hidden className="size-3" />
                        Ownership verified
                      </StatusPill>
                    ) : (
                      <StatusPill tone="warning">Not verified</StatusPill>
                    )}
                  </div>
                ) : (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    No Discord server linked yet.
                  </p>
                )}
                <p className="mt-1 max-w-prose text-xs text-muted-foreground">
                  The server this workspace runs in: where Boosty&apos;s bot assigns subscriber
                  roles and where match-log channels live.
                </p>
              </div>

              <div>
                <p className={EYEBROW_CLASS}>Your servers</p>
                {guildsQuery.isLoading ? (
                  <p className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle aria-hidden className="size-4 animate-spin" />
                    Asking Discord which servers you administer…
                  </p>
                ) : null}

                {guildsQuery.isError ? (
                  <p className="mt-1.5 max-w-prose text-sm text-destructive">
                    Discord could not be reached, so your servers could not be listed. Try again in
                    a moment.
                  </p>
                ) : null}

                {/* No administered server is not an error — most often the
                    Discord account simply is not linked yet, and the fix is one
                    screen away rather than on this one. */}
                {!guildsQuery.isLoading && !guildsQuery.isError && manageable.length === 0 ? (
                  <div className="mt-1.5 max-w-prose rounded-lg border border-dashed border-border p-4">
                    <p className="text-sm">
                      You do not administer any Discord server that this account can see.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Link your Discord account (or reconnect it, so the server list is fresh) in
                      account settings, then come back. You need to own the server or have Manage
                      Server on it.
                    </p>
                    <Button asChild variant="outline" size="sm" className="mt-3">
                      <Link href="/?settings=profile">Open account settings</Link>
                    </Button>
                  </div>
                ) : null}

                {manageable.length > 0 ? (
                  <ul className="mt-1.5 flex flex-col gap-2">
                    {manageable.map((guild) => {
                      const isBound = guild.guild_id === boundId;
                      return (
                        <li
                          key={guild.guild_id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{guild.name}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {guild.guild_id}
                              {guild.owner ? " · owner" : " · manage server"}
                            </p>
                          </div>
                          {isBound ? (
                            <StatusPill tone="success">
                              <CheckCircle aria-hidden className="size-3" />
                              Linked
                            </StatusPill>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={bind.isPending}
                              onClick={() => bind.mutate(guild.guild_id)}
                            >
                              {boundId ? "Link this instead" : "Link this server"}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {error ? (
                  <p role="alert" className="mt-3 max-w-prose text-sm font-medium text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      }}
    </WorkspaceSettingsFrame>
  );
}
