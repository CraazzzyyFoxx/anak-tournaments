"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { usePermissions } from "@/hooks/usePermissions";
import meService from "@/services/me.service";
import { revalidateUser } from "@/app/actions/users";

import { SettingsGroup, SwitchTile } from "./SettingsGroup";
import { userQueryKeys } from "@/lib/users/query-keys";

export default function PrivacySection() {
  const t = useTranslations("accountSettings");
  const { canUseCapability } = usePermissions();
  const queryClient = useQueryClient();

  // Same query as the profile tab's linked accounts: the flag rides on the
  // social profile, so both tabs read and write one cache entry.
  const socialQuery = useQuery({
    queryKey: userQueryKeys.mySocial(),
    queryFn: () => meService.getSocialAccounts(),
    enabled: canUseCapability("account.social"),
  });
  // Only an explicit `false` is a veto: responses cached before the flag
  // existed omit it entirely, and the backend default is "allowed" — the same
  // rule the per-account row applies to `visible_global`.
  const streamVisible = socialQuery.data?.stream_visible !== false;

  // The endpoint answers with the refreshed user, so the switch state comes
  // straight from the server; revalidating busts the Next Data Cache so the
  // public pages follow at once. Failures surface via the global mutation toast.
  const setStreamVisibility = useMutation({
    mutationFn: (visible: boolean) => meService.setStreamVisibility(visible),
    onSuccess: (user) => {
      void revalidateUser(user.id);
      queryClient.setQueryData(userQueryKeys.mySocial(), user);
    },
  });

  return (
    <SettingsGroup title={t("stream.title")}>
      <SwitchTile
        id="stream-visibility"
        label={t("stream.toggleLabel")}
        desc={t("stream.toggleDesc")}
        checked={streamVisible}
        // Never let the switch act on a guess: without a loaded response
        // there is no current value to invert, and a wrong payload here
        // silently re-publishes a stream the user meant to hide.
        disabled={!socialQuery.data || setStreamVisibility.isPending}
        onCheckedChange={(next) => setStreamVisibility.mutate(next)}
      />
      <p className="text-caption text-pretty text-[color:var(--aqt-fg-dim)]">{t("stream.footnote")}</p>
    </SettingsGroup>
  );
}
