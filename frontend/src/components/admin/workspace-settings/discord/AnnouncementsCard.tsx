"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SettingGroup, SettingRow } from "@/components/kit/SettingRow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { DiscordChannelSelect } from "@/components/discord/DiscordChannelSelect";
import { notificationQueryKeys } from "@/lib/notifications/query-keys";
import { notify } from "@/lib/notify";
import notificationService from "@/services/notification.service";
import type { NotificationWorkspaceConfigUpdate } from "@/types/notification.types";
import { announcementFailure } from "./errors";

/**
 * Human names for the kinds the server offers. The list itself comes from the
 * server (`broadcastable_kinds`), so a kind added there appears here without a
 * release: unnamed, but never missing.
 */
const KIND_MESSAGE_KEYS: Record<
  string,
  "registrationOpened" | "checkInOpened" | "encounterScheduled"
> = {
  "registration.opened": "registrationOpened",
  "check_in.opened": "checkInOpened",
  "encounter.scheduled": "encounterScheduled"
};

const LOCALES = [
  { value: "ru" },
  { value: "en" }
] as const;

/**
 * Where tournament events are announced, which of them, and in what language.
 *
 * Saves on every change like the rest of this page: each field stands on its
 * own, and a draft-and-save bar beside controls that save instantly is how an
 * edit gets left behind. The body is always all three fields, because that is
 * what the RPC takes.
 */
export function AnnouncementsCard({ workspaceId }: Readonly<{ workspaceId: number }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.discord");
  const contentT = useTranslations("adminWorkspace.content.fields");
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const configQuery = useQuery({
    queryKey: notificationQueryKeys.workspaceConfig(workspaceId),
    queryFn: () => notificationService.workspaceConfig(workspaceId)
  });
  const config = configQuery.data;

  const save = useMutation({
    mutationFn: (body: NotificationWorkspaceConfigUpdate) =>
      notificationService.updateWorkspaceConfig(workspaceId, body),
    onSuccess: (saved) => {
      setError(null);
      queryClient.setQueryData(notificationQueryKeys.workspaceConfig(workspaceId), saved);
      notify.success(t("saved"));
    },
    onError: (cause) => {
      setError(announcementFailure(cause, t));
      notify.apiError(cause, { title: t("saveAnnouncementError") });
    }
  });

  const update = (partial: Partial<NotificationWorkspaceConfigUpdate>) => {
    if (!config) return;
    save.mutate({
      discord_channel_id: config.discord_channel_id,
      locale: config.locale,
      broadcast_kinds: config.broadcast_kinds,
      ...partial
    });
  };

  return (
    <Card id="announcements">
      <CardContent className="pt-6">
        <SettingGroup title={t("announcements")}>
          {!config ? (
            <p className="py-2 text-sm text-muted-foreground">
              {configQuery.isError ? t("announcementLoadError") : t("announcementLoading")}
            </p>
          ) : (
            <>
              <SettingRow
                label={t("channel")}
                hint={t("channelHint")}
              >
                <div className="flex w-full items-center gap-2 md:max-w-sm">
                  <div className="min-w-0 flex-1">
                    <DiscordChannelSelect
                      workspaceId={workspaceId}
                      // The picker has no null: "" is its no-channel value.
                      value={config.discord_channel_id ?? ""}
                      onChange={(next) => update({ discord_channel_id: next === "" ? null : next })}
                      disabled={save.isPending}
                      ariaLabel={t("announcementChannelAria")}
                      placeholder={t("noChannel")}
                    />
                  </div>
                  {config.discord_channel_id ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={save.isPending}
                      onClick={() => update({ discord_channel_id: null })}
                    >
                      {t("unlink")}
                    </Button>
                  ) : null}
                </div>
              </SettingRow>

              <SettingRow
                label={t("events")}
                hint={t("eventsHint")}
              >
                <div className="flex flex-col gap-2">
                  {config.broadcastable_kinds.map((kind) => {
                    const id = `broadcast-${kind}`;
                    const checked = config.broadcast_kinds.includes(kind);
                    return (
                      <div key={kind} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={save.isPending}
                          onCheckedChange={(next) =>
                            update({
                              broadcast_kinds:
                                next === true
                                  ? [...config.broadcast_kinds, kind]
                                  : config.broadcast_kinds.filter((entry) => entry !== kind)
                            })
                          }
                        />
                        <Label htmlFor={id} className="text-sm font-normal">
                          {KIND_MESSAGE_KEYS[kind] ? contentT(KIND_MESSAGE_KEYS[kind]) : kind}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </SettingRow>

              <SettingRow
                htmlFor="announcement-locale"
                label={t("language")}
                hint={t("languageHint")}
              >
                <Select
                  value={config.locale}
                  onValueChange={(next) => update({ locale: next as "ru" | "en" })}
                  disabled={save.isPending}
                >
                  <SelectTrigger id="announcement-locale" className="w-full md:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCALES.map((locale) => (
                      <SelectItem key={locale.value} value={locale.value}>
                        {locale.value === "ru" ? t("russian") : t("english")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            </>
          )}
        </SettingGroup>

        {error ? (
          <p role="alert" className="mt-3 max-w-prose text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
