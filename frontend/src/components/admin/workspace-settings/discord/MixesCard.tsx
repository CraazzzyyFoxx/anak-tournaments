"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle } from "lucide-react";

import { SettingGroup, SettingRow } from "@/components/kit/SettingRow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { toggleVariants } from "@/components/ui/toggle";
import { DiscordChannelSelect } from "@/components/discord/DiscordChannelSelect";
import { useDiscordChannels } from "@/hooks/useDiscordEntities";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import balancerAdminService from "@/services/balancer-admin.service";
import type { DiscordVoicePermission } from "@/types/discord.types";
import type { WorkspaceBalancerConfigUpsert } from "@/types/balancer-admin.types";
import { balancerQueryKeys } from "@/lib/balancer/query-keys";

const VOICE_PERMISSION_MESSAGE_KEYS = {
  view_channel: "viewChannel",
  connect: "connect",
  move_members: "moveMembers"
} as const satisfies Record<DiscordVoicePermission, string>;

function missingLabel(
  t: (key: "viewChannel" | "connect" | "moveMembers") => string,
  missing: DiscordVoicePermission[] | null | undefined
): string | null {
  if (!missing || missing.length === 0) return null;
  return missing
    .map((name) => t(VOICE_PERMISSION_MESSAGE_KEYS[name]))
    .join(", ");
}

/**
 * Where every mix in this workspace announces its matchup, the voice category
 * it moves players through, and which of its voices players wait in.
 *
 * All three live in `balancer.workspace_config.config_json`, and the upsert
 * rewrites that whole blob, so every save posts every key (rank-delta knobs
 * included) with only the changed ones replaced. Same query key as the
 * balancer page's dialog, so both views agree after a save.
 */
export function MixesCard({ workspaceId }: Readonly<{ workspaceId: number }>) {
  const t = useTranslations("adminWorkspace.workspaceSettings.discord");
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: balancerQueryKeys.workspaceConfig(workspaceId),
    queryFn: () => balancerAdminService.getWorkspaceBalancerConfig(workspaceId)
  });
  const channelsQuery = useDiscordChannels(workspaceId);
  const config = configQuery.data;
  // The pickers speak in strings and have no null: "" is their empty value.
  const channel = config?.mix_discord_channel_id ?? "";
  const categoryId = config?.mix_voice_category_id ?? "";
  const generalIds = config?.mix_general_voice_channel_ids ?? [];

  const channels = channelsQuery.data?.channels ?? [];
  const categories = channels.filter((item) => item.type === "category");
  const category = categories.find((item) => item.id === categoryId);
  // A voice outside the category is not offered: the move would take a player
  // out of the mix's own corner of the server.
  const voices = channels.filter(
    (item) => item.type === "voice" && item.category_id === categoryId
  );
  const lacking = voices.flatMap((voice) => {
    const missing = missingLabel(t, voice.missing_permissions);
    return missing ? [`${voice.name}: ${missing}`] : [];
  });

  const save = useMutation({
    mutationFn: (partial: Partial<WorkspaceBalancerConfigUpsert>) =>
      balancerAdminService.upsertWorkspaceBalancerConfig(workspaceId, {
        rank_delta_threshold: config?.rank_delta_threshold ?? null,
        rank_delta_hide_from_pool: config?.rank_delta_hide_from_pool ?? false,
        mix_discord_channel_id: config?.mix_discord_channel_id ?? null,
        mix_voice_category_id: config?.mix_voice_category_id ?? null,
        mix_general_voice_channel_ids: config?.mix_general_voice_channel_ids ?? [],
        ...partial
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: balancerQueryKeys.workspaceConfig(workspaceId) });
      notify.success(t("saved"));
    },
    onError: (cause) => notify.apiError(cause, { title: t("saveMixError") })
  });

  const busy = configQuery.isLoading || channelsQuery.isLoading || save.isPending;
  const categoryMissing = missingLabel(t, category?.missing_permissions);

  return (
    <Card>
      <CardContent className="pt-6">
        <SettingGroup title={t("mixes")}>
          <SettingRow
            label={t("announcementChannel")}
            hint={t("announcementChannelHint")}
          >
            <div className="flex w-full items-center gap-2 md:max-w-sm">
              <div className="min-w-0 flex-1">
                <DiscordChannelSelect
                  workspaceId={workspaceId}
                  value={channel}
                  onChange={(next) => save.mutate({ mix_discord_channel_id: next === "" ? null : next })}
                  disabled={configQuery.isLoading || save.isPending}
                  ariaLabel={t("mixChannelAria")}
                  placeholder={t("noChannel")}
                />
              </div>
              {channel ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ mix_discord_channel_id: null })}
                >
                  {t("unlink")}
                </Button>
              ) : null}
            </div>
          </SettingRow>

          <SettingRow
            label={t("voiceCategory")}
            hint={t("voiceCategoryHint")}
          >
            <div className="flex w-full flex-col gap-1 md:max-w-sm">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Select
                    value={categoryId}
                    // A new category invalidates the old general voices: they
                    // belong to the category that is being left behind.
                    onValueChange={(next) =>
                      save.mutate({
                        mix_voice_category_id: next === "" ? null : next,
                        mix_general_voice_channel_ids: []
                      })
                    }
                    disabled={busy}
                  >
                    <SelectTrigger aria-label={t("mixVoiceCategory")}>
                      <SelectValue placeholder={t("noVoiceCategory")} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {categoryId !== "" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={save.isPending}
                    onClick={() =>
                      save.mutate({ mix_voice_category_id: null, mix_general_voice_channel_ids: [] })
                    }
                  >
                    {t("unlink")}
                  </Button>
                ) : null}
              </div>
              {categoryMissing ? (
                  <p className="text-xs text-warning">{t("missing", { value: categoryMissing })}</p>
              ) : null}
            </div>
          </SettingRow>

          {categoryId !== "" ? (
            <SettingRow
              label={t("generalVoices")}
              hint={t("generalVoicesHint")}
            >
              <div className="flex w-full flex-col gap-2 md:max-w-sm">
                {voices.length > 0 ? (
                  <div role="group" aria-label={t("generalVoices")} className="flex flex-wrap gap-1.5">
                    {voices.map((voice) => {
                      const pressed = generalIds.includes(voice.id);
                      const missing = missingLabel(t, voice.missing_permissions);
                      return (
                        <button
                          key={voice.id}
                          type="button"
                          aria-pressed={pressed}
                          data-state={pressed ? "on" : "off"}
                          disabled={busy}
                          onClick={() =>
                            save.mutate({
                              mix_general_voice_channel_ids: pressed
                                ? generalIds.filter((id) => id !== voice.id)
                                : [...generalIds, voice.id]
                            })
                          }
                          title={missing ? t("missing", { value: missing }) : undefined}
                          className={cn(
                            toggleVariants({ variant: "outline", size: "sm" }),
                            "rounded-full active:scale-[0.98]",
                            pressed && "border-primary/50"
                          )}
                        >
                          {pressed ? <CheckCircle aria-hidden className="size-3.5" /> : null}
                          {voice.name}
                          {missing ? (
                            <AlertTriangle aria-hidden className="size-3.5 text-warning" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {channelsQuery.isLoading ? t("asking") : t("noVoiceCategory")}
                  </p>
                )}
                {lacking.length > 0 ? (
                  <p className="text-xs text-warning">{t("missingOn", { value: lacking.join("; ") })}</p>
                ) : null}
              </div>
            </SettingRow>
          ) : null}
        </SettingGroup>
      </CardContent>
    </Card>
  );
}
