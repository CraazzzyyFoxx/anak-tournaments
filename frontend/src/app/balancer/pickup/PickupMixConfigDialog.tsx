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
import { RosterShapeEditor } from "@/components/roster-shape/RosterShapeEditor";
import { payloadTotalError } from "@/components/roster-shape/roster-shape-editor.model";
import { parseRoleMask } from "@/app/balancer/pickup/pickup-lineup";
import type { RosterSlotMap } from "@/lib/roster-shape";
import type { CustomGame } from "@/services/custom-game.service";

interface PickupMixConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: CustomGame | null | undefined;
  /** Host + not-terminal, same gate every other mix write uses. */
  canWrite: boolean;
  saving: boolean;
  onSave: (roleMask: RosterSlotMap | null) => void;
}

/**
 * Per-mix team composition -- the tournament settings tab's roster-shape
 * editor, wired to `CustomGame.config_json.role_mask` instead of
 * `Tournament.roster_slots_json`. A mix has no tournament level of its own:
 * "inherit" here means the workspace default one level up, exactly what
 * `CustomGameService.roster_shape` resolves against.
 */
export function PickupMixConfigDialog({
  open,
  onOpenChange,
  game,
  canWrite,
  saving,
  onSave
}: Readonly<PickupMixConfigDialogProps>) {
  const [pending, setPending] = useState<RosterSlotMap | null>(parseRoleMask(game?.config_json));
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPending(parseRoleMask(game?.config_json));
    }
  }

  const error = payloadTotalError(pending);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Team composition
          </DialogTitle>
          <DialogDescription>
            How many slots of each kind one team in this mix has. Balance fills exactly these
            slots.
          </DialogDescription>
        </DialogHeader>

        <RosterShapeEditor
          entity="mix"
          value={pending}
          effective={game?.roster_shape ?? null}
          disabled={!canWrite}
          onChange={setPending}
        />

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || saving || error !== null}
            onClick={() => onSave(pending)}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
