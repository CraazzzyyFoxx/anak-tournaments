"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SaveBar } from "@/components/kit/SaveBar";
import adminService from "@/services/admin.service";
import type { Tournament } from "@/types/tournament.types";
import { TournamentDiscordSection } from "../../components/TournamentDiscordSection";
import { getTournamentWorkspaceQueryKeys } from "@/lib/tournament/workspace-query-keys";
import { SettingsSectionPage } from "../SettingsSection";
import { useTournamentSettingsForm } from "../useTournamentSettingsForm";

export default function DiscordSettingsPage() {
  const t = useTranslations("adminTournament.discordSettings");
  return (
    <SettingsSectionPage
      section="discord"
      description={t("description")}
    >
      {({ tournament, tournamentId, canUpdateTournament }) => (
        <DiscordSettings
          tournamentId={tournamentId}
          tournament={tournament}
          canUpdateTournament={canUpdateTournament}
        />
      )}
    </SettingsSectionPage>
  );
}

function DiscordSettings({
  tournamentId,
  tournament,
  canUpdateTournament
}: Readonly<{
  tournamentId: number;
  tournament: Tournament;
  canUpdateTournament: boolean;
}>) {
  const t = useTranslations("adminTournament.discordSettings");
  const channelQuery = useQuery({
    queryKey: getTournamentWorkspaceQueryKeys(tournamentId).discordChannel,
    queryFn: () => adminService.getDiscordChannel(tournamentId)
  });

  const { form, patch, dirty, summary, saving, save, discard } = useTournamentSettingsForm(
    tournament,
    tournamentId,
    "discord"
  );

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="settings-discord-broadcasts" className="cursor-pointer">
                  {t("announcements")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("announcementsDescription")}
                </p>
              </div>
              <Switch
                id="settings-discord-broadcasts"
                checked={form.discord_broadcasts_enabled}
                disabled={!canUpdateTournament}
                onCheckedChange={(checked) => patch({ discord_broadcasts_enabled: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="settings-discord-dms" className="cursor-pointer">
                  {t("messages")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("messagesDescription")}
                </p>
              </div>
              <Switch
                id="settings-discord-dms"
                checked={form.discord_dms_enabled}
                disabled={!canUpdateTournament}
                onCheckedChange={(checked) => patch({ discord_dms_enabled: checked })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <TournamentDiscordSection
            tournamentId={tournamentId}
            tournament={tournament}
            canUpdateTournament={canUpdateTournament}
            discordChannel={channelQuery.data}
            discordChannelLoading={channelQuery.isLoading}
          />
        </CardContent>
      </Card>

      <SaveBar dirty={dirty} summary={summary} saving={saving} onDiscard={discard} onSave={save} />
    </>
  );
}
