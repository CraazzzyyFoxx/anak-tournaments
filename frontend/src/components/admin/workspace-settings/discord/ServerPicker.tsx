"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { CheckCircle } from "lucide-react";

import { StatusPill } from "@/components/kit/StatusPill";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ManageableDiscordGuild } from "@/types/workspace.types";
import { GuildMark } from "./GuildMark";

/**
 * The servers this account administers, each one bindable.
 *
 * Rendered inline while nothing is linked and inside the "Change server"
 * dialog afterwards: one list, so the two cannot disagree about which servers
 * are offered or how a refusal reads.
 */
export function ServerPicker({
  boundId,
  guilds,
  loading,
  failed,
  pendingId,
  error,
  onBind
}: Readonly<{
  boundId: string | null;
  guilds: ManageableDiscordGuild[];
  loading: boolean;
  failed: boolean;
  pendingId: string | null;
  error: string | null;
  onBind: (guildId: string) => void;
}>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.discord");
  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t("asking")}
        </p>
      ) : null}

      {failed ? (
        <p className="max-w-prose text-sm text-danger">
          {t("unreachable")}
        </p>
      ) : null}

      {/* No administered server is not an error: most often the Discord account
          simply is not linked yet, and the fix is one screen away. */}
      {!loading && !failed && guilds.length === 0 ? (
        <div className="max-w-prose rounded-lg border border-dashed border-border p-4">
          <p className="text-sm">{t("none")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("linkHelp")}
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href="/?settings=profile">{t("accountSettings")}</Link>
          </Button>
        </div>
      ) : null}

      {guilds.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-border">
          {guilds.map((guild) => (
            <li key={guild.guild_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <GuildMark name={guild.name} src={guild.icon_url} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={guild.name}>
                    {guild.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {guild.owner ? t("owner") : t("linkServer")}
                  </p>
                </div>
              </div>
              {guild.guild_id === boundId ? (
                <StatusPill tone="success">
                  <CheckCircle aria-hidden className="size-3" />
                  {t("linked")}
                </StatusPill>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingId !== null}
                  onClick={() => onBind(guild.guild_id)}
                >
                  {pendingId === guild.guild_id ? <Spinner /> : null}
                  {t(boundId ? "linkThisInstead" : "linkServer")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="max-w-prose text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
