"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveBar } from "@/components/admin/kit/SaveBar";
import { WorkspaceSettingsFrame } from "./WorkspaceSettingsFrame";
import { useWorkspaceSettingsForm } from "./useWorkspaceSettingsForm";

const GUILD_ID_PATTERN = /^\d{17,19}$/;

/** The one Discord guild a workspace runs in: patron roles and match-log channels alike. */
export function DiscordSection({ workspaceId }: Readonly<{ workspaceId: number | null }>) {
  const settings = useWorkspaceSettingsForm(workspaceId, "discord");
  const { patch } = settings;

  return (
    <WorkspaceSettingsFrame workspaceId={workspaceId} settings={settings}>
      {({ form: values }) => {
        const guildId = values.discord_guild_id;
        const malformed = !!guildId && !GUILD_ID_PATTERN.test(guildId);
        return (
          <>
            <Card>
              <CardContent className="pt-6">
                <Label htmlFor="discord-guild-id">Discord guild ID</Label>
                <Input
                  id="discord-guild-id"
                  className="mt-1.5 font-mono"
                  value={guildId ?? ""}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="123456789012345678"
                  maxLength={19}
                  aria-invalid={malformed}
                  aria-describedby="discord-guild-id-help"
                  onChange={(event) =>
                    patch({ discord_guild_id: event.target.value.replace(/\D/g, "") || null })
                  }
                />
                {malformed ? (
                  <p className="mt-1 text-xs font-medium text-destructive">
                    A Discord server ID is 17–19 digits — this one is {guildId?.length}. Saving now
                    would fail.
                  </p>
                ) : null}
                <p id="discord-guild-id-help" className="mt-1 max-w-prose text-xs text-muted-foreground">
                  The server this workspace runs in: where Boosty&apos;s bot assigns subscriber
                  roles and where match-log channels live. Enable Developer Mode in Discord, then
                  right-click the server &rarr; Copy Server ID.
                </p>
              </CardContent>
            </Card>

            <SaveBar
              dirty={settings.dirty}
              summary={settings.summary}
              saving={settings.saving}
              onDiscard={settings.discard}
              onSave={settings.save}
            />
          </>
        );
      }}
    </WorkspaceSettingsFrame>
  );
}
