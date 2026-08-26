"use client";

import { useState } from "react";
import { Settings2, SlidersHorizontal } from "lucide-react";

import { BalancerConfigDrawer } from "@/app/balancer/components/BalancerConfigDrawer";
import {
  CUSTOM_PRESET,
  findMatchingPreset,
  sanitizeBalancerConfig
} from "@/app/balancer/components/balancer-config-helpers";
import { PRESET_LABELS } from "@/app/balancer/components/balancer-page-helpers";
import { getPresetOptions } from "@/app/balancer/components/balancer-page-selectors";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { RosterShapeEditor } from "@/components/roster-shape/RosterShapeEditor";
import { payloadTotalError } from "@/components/roster-shape/roster-shape-editor.model";
import { parseBalancerConfig, parsePointsPerWin, parseRoleMask } from "@/app/balancer/pickup/pickup-lineup";
import type { RosterSlotMap } from "@/lib/roster-shape";
import type { CustomGame } from "@/services/custom-game.service";
import type { BalancerConfig, BalancerConfigResponse } from "@/types/balancer.types";

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
  /** Field metadata + presets for the balancer algorithm section -- the same
   * public config the tournament balancer page reads, shared here so a mix
   * gets the identical preset list and weight editor. */
  balancerConfigData: BalancerConfigResponse | undefined;
  /** `setBalancerConfig` in flight, disables the algorithm section's own controls. */
  balancerConfigSaving: boolean;
  /** Writes straight through, independent of the dialog's own Save button --
   * a preset pick or a drawer save takes effect immediately, like every other
   * "own value or inherit" knob (`role_mask`) except it skips the batching
   * this dialog does for that one and `points_per_win`. */
  onSaveBalancerConfig: (balancerConfig: BalancerConfig | null) => void;
}

/**
 * Per-mix settings: team composition -- the tournament settings tab's
 * roster-shape editor, wired to `CustomGame.config_json.role_mask` instead of
 * `Tournament.roster_slots_json`. A mix has no tournament level of its own:
 * "inherit" here means the workspace default one level up, exactly what
 * `CustomGameService.roster_shape` resolves against. And the rank-adjustment-
 * per-win: recording a win/loss then bumps the host's own rank book by this
 * many points, letting a night of mixes self-correct without the host
 * retyping ranks between games.
 *
 * The balancer algorithm section reuses the tournament balancer page's own
 * preset list and `BalancerConfigDrawer` field editor, backed by
 * `config_json`'s non-reserved keys (`custom.set_balancer_config`) instead of
 * a saved tournament config -- the same weights, a different owner.
 */
export function PickupMixConfigDialog({
  open,
  onOpenChange,
  game,
  canWrite,
  saving,
  onSave,
  balancerConfigData,
  balancerConfigSaving,
  onSaveBalancerConfig
}: Readonly<PickupMixConfigDialogProps>) {
  const [pending, setPending] = useState<RosterSlotMap | null>(parseRoleMask(game?.config_json));
  const [pendingPoints, setPendingPoints] = useState<number | null>(parsePointsPerWin(game?.config_json));
  const [draftBalancerConfig, setDraftBalancerConfig] = useState<BalancerConfig>(
    parseBalancerConfig(game?.config_json)
  );
  const [isBalancerDrawerOpen, setIsBalancerDrawerOpen] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPending(parseRoleMask(game?.config_json));
      setPendingPoints(parsePointsPerWin(game?.config_json));
      setDraftBalancerConfig(parseBalancerConfig(game?.config_json));
    } else {
      setIsBalancerDrawerOpen(false);
    }
  }

  const error = payloadTotalError(pending);

  const presetOptions = getPresetOptions(balancerConfigData?.presets);
  const matchedPreset = balancerConfigData
    ? findMatchingPreset(draftBalancerConfig, balancerConfigData.presets)
    : null;
  const selectedBalancerPreset =
    matchedPreset ?? (Object.keys(draftBalancerConfig).length > 0 ? CUSTOM_PRESET : "DEFAULT");
  const visibleBalancerPresetOptions =
    selectedBalancerPreset === CUSTOM_PRESET && !presetOptions.includes(CUSTOM_PRESET)
      ? [...presetOptions, CUSTOM_PRESET]
      : presetOptions;
  const selectedBalancerPresetLabel =
    selectedBalancerPreset === CUSTOM_PRESET
      ? "Custom"
      : (PRESET_LABELS[selectedBalancerPreset] ?? selectedBalancerPreset);

  const handleSelectBalancerPreset = (preset: string) => {
    const presetConfig = balancerConfigData?.presets[preset];
    if (!presetConfig) return;
    const sanitized = sanitizeBalancerConfig(presetConfig);
    setDraftBalancerConfig(sanitized);
    onSaveBalancerConfig(sanitized);
  };

  return (
    <>
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

          <div className="space-y-1.5 border-t border-[color:var(--aqt-border)] pt-4">
            <Label>Balancer algorithm</Label>
            <div className="flex items-center gap-2">
              <Select
                value={selectedBalancerPreset}
                onValueChange={handleSelectBalancerPreset}
                disabled={!canWrite || balancerConfigSaving}
              >
                <SelectTrigger className="h-9 flex-1">
                  <SelectValue placeholder="Preset" />
                </SelectTrigger>
                <SelectContent>
                  {visibleBalancerPresetOptions.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {PRESET_LABELS[preset] ?? preset}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={!canWrite || balancerConfigSaving}
                onClick={() => setIsBalancerDrawerOpen(true)}
                aria-label="Customize balancer weights"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              How the solver weighs rank balance, role comfort and team spread when this mix is balanced.
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

      <BalancerConfigDrawer
        open={isBalancerDrawerOpen}
        onOpenChange={setIsBalancerDrawerOpen}
        fields={balancerConfigData?.fields ?? []}
        config={draftBalancerConfig}
        selectedPresetLabel={selectedBalancerPresetLabel}
        dirty={selectedBalancerPreset === CUSTOM_PRESET}
        saving={balancerConfigSaving}
        onChange={(key, value) =>
          setDraftBalancerConfig((current) => sanitizeBalancerConfig({ ...current, [key]: value }))
        }
        onSave={() => {
          onSaveBalancerConfig(
            Object.keys(draftBalancerConfig).length > 0 ? draftBalancerConfig : null
          );
          setIsBalancerDrawerOpen(false);
        }}
        onReset={() =>
          setDraftBalancerConfig(
            balancerConfigData ? sanitizeBalancerConfig(balancerConfigData.defaults) : {}
          )
        }
      />
    </>
  );
}
