"use client";

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
  /** Clones a published version into a new draft. */
  onClone: () => void;
}

/**
 * The editor header's buttons: undo, discard, publish a draft, activate or
 * clone a published version. An action whose precondition is unmet is absent;
 * "Ready to publish?" says what is missing.
 */
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
  onActivate,
  onClone
}: Readonly<DraftEditorActionsProps>) {
  const t = useTranslations("adminSettings.divisions");
  const isDraft = version.status === "draft";
  return (
    <>
      {editable && canUndo ? (
        <Button variant="outline" size="sm" onClick={onUndo}>
          {t("editor.undo")}
        </Button>
      ) : null}
      {editable && canDelete ? (
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          {t("editor.discardDraft")}
        </Button>
      ) : null}
      {canPublish && isDraft && publishable ? (
        <Button size="sm" disabled={publishing} onClick={onPublish}>
          {t("editor.publishVersion", { version: version.version })}
        </Button>
      ) : null}
      {canPublish && !isDraft ? (
        <Button variant="outline" size="sm" onClick={onClone}>
          {t("editor.createDraft")}
        </Button>
      ) : null}
      {canPublish && !isDraft && version.id !== activeVersionId && activationReady ? (
        <Button size="sm" disabled={activating} onClick={onActivate}>
          {t("activateVersion", { version: version.version })}
        </Button>
      ) : null}
    </>
  );
}
