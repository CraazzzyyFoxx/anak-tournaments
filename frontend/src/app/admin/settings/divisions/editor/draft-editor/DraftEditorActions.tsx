"use client";

import { RotateCcw, Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { DivisionGridVersion } from "@/types/workspace.types";

interface DraftEditorActionsProps {
  version: DivisionGridVersion;
  activeVersionId: number | null;
  editable: boolean;
  canPublish: boolean;
  canDelete: boolean;
  canUndo: boolean;
  publishable: boolean;
  publishing: boolean;
  /** Readiness says every source is mapped, so the version may become the default. */
  activationReady: boolean;
  activating: boolean;
  onUndo: () => void;
  onDiscard: () => void;
  onPublish: () => void;
  onActivate: () => void;
}

/** The editor header's buttons: undo, discard, publish a draft, activate a published version. */
export function DraftEditorActions({
  version,
  activeVersionId,
  editable,
  canPublish,
  canDelete,
  canUndo,
  publishable,
  publishing,
  activationReady,
  activating,
  onUndo,
  onDiscard,
  onPublish,
  onActivate
}: Readonly<DraftEditorActionsProps>) {
  const t = useTranslations("adminSettings.divisions");
  return (
    <>
      {editable ? (
        <Button
          variant="outline"
          size="sm"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <RotateCcw aria-hidden className="size-4" />
          {t("editor.undo")}
        </Button>
      ) : null}
      {editable && canDelete ? (
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          <Trash2 aria-hidden className="size-4" />
          {t("editor.discardDraft")}
        </Button>
      ) : null}
      {canPublish && version.status === "draft" ? (
        <Button
          size="sm"
          disabled={!publishable || publishing}
          title={
            publishable
              ? undefined
              : t("editorDetails.publishBlocked")
          }
          onClick={onPublish}
        >
          {t("editor.publishVersion", { version: version.version })}
        </Button>
      ) : null}
      {canPublish && version.status !== "draft" && version.id !== activeVersionId ? (
        <Button
          size="sm"
          disabled={!activationReady || activating}
          title={
            activationReady
              ? undefined
              : t("editorDetails.mappingBlocked")
          }
          onClick={onActivate}
        >
          <Star aria-hidden className="size-4" />
          {t("activateVersion", { version: version.version })}
        </Button>
      ) : null}
    </>
  );
}
