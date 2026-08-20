"use client";

/**
 * Shared pieces for the game-catalogue admin pages (maps, heroes, gamemodes).
 *
 * All three pages are the same shape — a sync-from-game + create toolbar and a
 * dialog that doubles as create and edit — so the toolbar and the two dialog
 * helpers live here instead of being copy-pasted three times.
 */

import { Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface CatalogToolbarActionsProps {
  /**
   * Permission gate for the cluster. Syncing and creating a catalogue entry are
   * granted together (superuser), so the toolbar renders nothing when false.
   */
  canSync: boolean;
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
  if (!canSync) {
    return null;
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={onSync} disabled={isSyncing} aria-busy={isSyncing}>
        <RefreshCw aria-hidden className={`mr-2 h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
        {syncLabel}
      </Button>
      <Button onClick={onCreate}>
        <Plus aria-hidden className="mr-2 h-4 w-4" />
        {createLabel}
      </Button>
    </div>
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
  createError: unknown
): string | undefined {
  const error = isEditing ? updateError : createError;
  if (!error) {
    return undefined;
  }

  const advice = `Check the ${entity} details and try again.`;
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
