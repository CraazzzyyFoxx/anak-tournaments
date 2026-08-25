"use client";

import { WorkspacePlayersSidebar } from "@/app/balancer/components/WorkspacePlayersSidebar";
import { CAPTION_CLASS } from "@/app/balancer/pickup/pickup-chrome";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { RosterMember } from "@/services/workspace-player.service";

type PickupPoolDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  canEdit: boolean;
  /** Workspace member ids already in this mix, so a row reads as in or out. */
  selectedIds: number[];
  onTogglePlayer: (member: RosterMember) => void;
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
 * same behaviour here, and a fork would be the second place they drift. The
 * sidebar owns the whole frame — its own "Players" heading, count and
 * add-by-BattleTag control — so this shell contributes only the one fact it
 * knows and the sidebar does not: how many of them are in *this* mix.
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
        {/* Screen-reader only: the sidebar below renders the visible heading, and
            two "Players" titles read as two lists. Radix still needs a title. */}
        <DialogTitle className="sr-only">Workspace players</DialogTitle>
        <DialogDescription className="sr-only">
          Add players to this mix or edit the ranks the balancer uses for them.
        </DialogDescription>

        {/* `[&>div]:border-0` strips the sidebar's own card chrome: inside a
            dialog its border and radius drew a second frame just inside this one. */}
        <div className="min-h-0 flex-1 overflow-hidden p-3 pb-0 [&>div]:h-full [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent">
          <WorkspacePlayersSidebar
            workspaceId={workspaceId}
            scope="author"
            canEdit={canEdit}
            selectedIds={selectedIds}
            onTogglePlayer={onTogglePlayer}
          />
        </div>

        <div className="flex items-center gap-3 border-t border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)] px-5 py-3">
          <span className={cn(CAPTION_CLASS, "min-w-0")}>
            {/* Not "ranks carry across every tournament" any more: the workspace
                value is the fallback, and the host's own book is what actually
                decides this mix. */}
            {`${selectedIds.length} in this mix \u00B7 your own ranks decide it, workspace ranks fill the gaps`}
          </span>
          <Button
            type="button"
            className="ml-auto h-8 shrink-0"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
