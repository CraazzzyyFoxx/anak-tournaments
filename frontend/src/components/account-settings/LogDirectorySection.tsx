"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FolderOpen } from "lucide-react";
import { AutoUploadStatus } from "@/components/logs/AutoUploadStatus";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { directoryErrorCode } from "@/lib/logs/browser-directory";
import { useLogDirectory } from "@/lib/logs/use-log-directory";
import { SettingsGroup, SwitchTile } from "./SettingsGroup";

export function LogDirectorySection() {
  const t = useTranslations("accountSettings.logDirectory");
  const directory = useLogDirectory();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(t(`errors.${directoryErrorCode(cause)}`));
    } finally {
      setBusy(false);
    }
  }

  const visibleError = error ?? (directory.error ? t(`errors.${directoryErrorCode(directory.error)}`) : null);

  return (
    <>
      <SettingsGroup title={t("title")} description={t("hint")}>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-2)] py-1.5 pl-3 pr-1.5">
          <FolderOpen className="size-4 shrink-0 text-[color:var(--aqt-fg-muted)]" aria-hidden />
          <div className="min-w-0 flex-1 truncate text-sm text-[color:var(--aqt-fg)]" role="status">
            {directory.isLoading ? (
              <>
                <span className="sr-only">{t("loading")}</span>
                <Skeleton aria-hidden className="h-4 w-32" />
              </>
            ) : (
              directory.handle?.name ?? t("none")
            )}
          </div>
          <Button type="button" size="sm" variant="outline" disabled={busy || directory.isLoading} onClick={() => void run(directory.select)}>
            {directory.handle ? t("replace") : t("select")}
          </Button>
          {directory.handle ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(directory.forget)}>
              {t("forget")}
            </Button>
          ) : null}
        </div>
        {visibleError ? <p className="text-sm text-destructive" role="alert">{visibleError}</p> : null}
      </SettingsGroup>

      <SettingsGroup title={t("auto.title")}>
        <SwitchTile
          id="log-auto-upload"
          label={t("auto.toggle")}
          desc={directory.handle ? t("auto.toggleHint") : t("auto.needsFolder")}
          checked={directory.autoUpload}
          disabled={!directory.handle}
          onCheckedChange={directory.setAutoUpload}
        />
        {directory.autoUpload ? (
          <AutoUploadStatus folder={directory.handle?.name ?? ""} idle={t("auto.idle")} />
        ) : null}
      </SettingsGroup>
    </>
  );
}
