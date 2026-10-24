"use client";

/**
 * Shared pieces for the game-catalogue admin pages (maps, heroes, gamemodes).
 *
 * All three pages are the same shape — a sync-from-game + create toolbar and a
 * dialog that doubles as create and edit — so the toolbar and the two dialog
 * helpers live here instead of being copy-pasted three times.
 */

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface CatalogToolbarActionsProps {
  /**
   * Permission gate for the cluster. Syncing and creating a catalogue entry are
   * granted together (superuser), so the toolbar renders nothing when false.
   */
  canSync: boolean;
  /** A sync runs in the background: the button says so and stays clickable — `onSync` then reopens its modal. */
  isSyncing: boolean;
  onSync: () => void;
  /** Sentence-case label naming the object, e.g. "Sync maps from game". */
  syncLabel: string;
  onCreate: () => void;
  /** Sentence-case label naming the object, e.g. "Create map". */
  createLabel: string;
}

export function CatalogToolbarActions({
  canSync,
  isSyncing,
  onSync,
  syncLabel,
  onCreate,
  createLabel
}: Readonly<CatalogToolbarActionsProps>) {
  const t = useTranslations("adminWorkspace.content.catalog.sync");
  if (!canSync) {
    return null;
  }

  return (
    // A fragment, not a row: the table toolbar's control group wraps its own
    // children, so the buttons drop to a new line on a phone instead of
    // pushing off the left edge as one unbreakable block.
    <>
      <Button variant="outline" onClick={onSync}>
        {isSyncing ? <Spinner /> : null}
        {isSyncing ? t("running") : syncLabel}
      </Button>
      <Button onClick={onCreate}>
        <Plus aria-hidden className="mr-2 h-4 w-4" />
        {createLabel}
      </Button>
    </>
  );
}

/**
 * Secondary error text for a create/edit dialog: picks the mutation actually in
 * play, names the object and says what to do. `EntityFormDialog` already renders
 * the "Could not save your changes." lead, so this must not repeat it — and a
 * raw API message is never the whole message, only parenthesised detail.
 */
export function entityFormError(
  entity: string,
  isEditing: boolean,
  updateError: unknown,
  createError: unknown,
  t: (key: "formError", values: { entity: string }) => string
): string | undefined {
  const error = isEditing ? updateError : createError;
  if (!error) {
    return undefined;
  }

  const advice = t("formError", { entity });
  const detail = error instanceof Error ? error.message.trim() : "";

  return detail ? `${advice} (${detail})` : advice;
}

/**
 * `onOpenChange` for a dialog that doubles as create and edit: dismissing it has
 * to clear the create flag, the edit target and the draft together.
 */
export function onEntityDialogClose(reset: () => void): (open: boolean) => void {
  return (open) => {
    if (!open) {
      reset();
    }
  };
}
