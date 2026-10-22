"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";

import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Start match (spec §5.1), on a lobby's card and in its room alike. An away player still seated in the lineup does
 * not block the start -- they may well be back by the time the lobby loads -- but the host hears about it first.
 */
export function StartMatchButton({
  awayNames,
  starting,
  onStart,
}: Readonly<{ awayNames: readonly string[]; starting: boolean; onStart: () => void }>) {
  const t = useTranslations("mixes.room");
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <Button type="button" disabled={starting} onClick={() => (awayNames.length > 0 ? setConfirmOpen(true) : onStart())}>
        {starting ? <Spinner className="mr-1.5 size-3.5" /> : <Play className="mr-1.5 size-3.5" aria-hidden="true" />}
        {t("startMatch")}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        intent={{
          title: t("awayTitle"),
          description: t("awayDescription", { names: awayNames.join(", ") }),
          confirmLabel: t("awayConfirm"),
          tone: "warning",
        }}
        pending={starting}
        onConfirm={() => {
          setConfirmOpen(false);
          onStart();
        }}
      />
    </>
  );
}
