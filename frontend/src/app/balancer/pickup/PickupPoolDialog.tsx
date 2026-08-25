"use client";

import { WorkspacePlayersSidebar } from "@/app/balancer/components/WorkspacePlayersSidebar";
import { CAPTION_CLASS, EYEBROW_CLASS } from "@/app/balancer/pickup/pickup-chrome";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { WorkspacePlayer } from "@/services/workspace-player.service";

type PickupPoolDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  canEdit: boolean;
  /** Workspace player ids already in this mix, so a row reads as in or out. */
  selectedIds: number[];
  onTogglePlayer: (player: WorkspacePlayer) => void;
};

/**
 * The workspace roster, on demand.
 *
 * The pool used to be a permanent third column, which cost a third of the screen
 * to answer a question a host asks twice a night — at the start, and when a
 * latecomer shows up. As an overlay it gets the room it actually needs (rank
 * pickers, search, paging) and gives the lineup and the matchup the width they
 * need the rest of the time.
 *
 * It reuses the sidebar the tournament balancer renders in-place rather than
 * forking a second roster view: membership, ranks, search and paging are the
 * same behaviour here, and a fork would be the second place they drift.
 */
export function PickupPoolDialog({
  open,
  onOpenChange,
  workspaceId,
  canEdit,
  selectedIds,
  onTogglePlayer,
}: Readonly<PickupPoolDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Wider and taller than the default dialog: the roster is a working
        // surface, and at `sm:max-w-lg` its rank pickers wrapped onto a
        // second line for every row.
        className="flex max-h-[calc(100svh-5rem)] w-[min(48rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <div className="flex items-start gap-3 border-b border-[color:var(--aqt-border)] px-5 pb-3.5 pt-4">
          <div className="min-w-0">
            <DialogTitle className={cn(EYEBROW_CLASS, "font-normal")}>Players</DialogTitle>
            <DialogDescription className={cn(CAPTION_CLASS, "mt-1")}>
              {`${selectedIds.length} in this mix \u00B7 ranks carry across every tournament in this workspace`}
            </DialogDescription>
          </div>
          <Button
            type="button"
            className="ml-auto h-8 shrink-0"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>

        {/* `[&>div]:border-0` strips the sidebar's own card chrome: inside a
            dialog its border and radius drew a second frame just inside this one. */}
        <div className="min-h-0 flex-1 overflow-hidden p-3 [&>div]:h-full [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent">
          <WorkspacePlayersSidebar
            workspaceId={workspaceId}
            canEdit={canEdit}
            selectedIds={selectedIds}
            onTogglePlayer={onTogglePlayer}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
