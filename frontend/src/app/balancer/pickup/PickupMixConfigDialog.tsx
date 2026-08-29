"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { RosterShapeEditor } from "@/components/roster-shape/RosterShapeEditor";
import { payloadTotalError } from "@/components/roster-shape/roster-shape-editor.model";
import type { RosterSlotMap } from "@/lib/roster-shape";
import type { CustomGame } from "@/services/custom-game.service";

/** What `onSave` writes: the two independent config knobs this dialog owns. */
export type PickupMixConfigInput = {
  roleMask: RosterSlotMap | null;
  /** The rank-adjustment-per-win, or `null` to disable it. */
  pointsPerWin: number | null;
};

interface PickupMixConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: CustomGame | null | undefined;
  /** Host + not-terminal, same gate every other mix write uses. */
  canWrite: boolean;
  saving: boolean;
  onSave: (input: PickupMixConfigInput) => void;
}

/**
 * Per-mix settings: team composition -- the tournament settings tab's
 * roster-shape editor, wired to `CustomGame.settings.role_mask` instead of
 * `Tournament.roster_slots_json`. A mix has no tournament level of its own:
 * "inherit" here means the workspace default one level up, exactly what
 * `CustomGameService.roster_shape` resolves against. And the rank-adjustment-
 * per-win: recording a win/loss then bumps the host's own rank book by this
 * many points, letting a night of mixes self-correct without the host
 * retyping ranks between games.
 */
export function PickupMixConfigDialog({
  open,
  onOpenChange,
  game,
  canWrite,
  saving,
  onSave
}: Readonly<PickupMixConfigDialogProps>) {
  const [pending, setPending] = useState<RosterSlotMap | null>(game?.settings.role_mask ?? null);
  const [pendingPoints, setPendingPoints] = useState<number | null>(
    game?.settings.points_per_win ?? null,
  );
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPending(game?.settings.role_mask ?? null);
      setPendingPoints(game?.settings.points_per_win ?? null);
    }
  }

  const error = payloadTotalError(pending);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Mix settings
          </DialogTitle>
          <DialogDescription>
            Team composition and how recording a result affects the roster&apos;s ranks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Team composition</Label>
          <RosterShapeEditor
            entity="mix"
            value={pending}
            effective={game?.roster_shape ?? null}
            disabled={!canWrite}
            onChange={setPending}
          />
        </div>

        <div className="space-y-1.5 border-t border-[color:var(--aqt-border)] pt-4">
          <Label htmlFor="points-per-win">
            Points per win
            <span className="ml-1.5 text-xs text-muted-foreground">
              (rank points, empty = off)
            </span>
          </Label>
          <NumberInput
            id="points-per-win"
            integer
            min={0}
            max={1000}
            disabled={!canWrite}
            placeholder="e.g. 25"
            value={pendingPoints}
            onValueChange={setPendingPoints}
          />
          <p className="text-xs text-muted-foreground">
            Recording who won then bumps every winning player&apos;s rank by this many points, and every
            losing player&apos;s down by the same, in the host&apos;s own book.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || saving || error !== null}
            onClick={() => onSave({ roleMask: pending, pointsPerWin: pendingPoints })}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
