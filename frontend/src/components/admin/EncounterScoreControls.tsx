import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  GROUP_STAGE_SCORE_PRESETS,
  clampScoreValue,
  getMatchingScorePreset,
  type EncounterScore,
} from "@/components/admin/encounter-score";

type EncounterScoreControlsProps = EncounterScore & {
  idPrefix: string;
  homeLabel?: string;
  awayLabel?: string;
  presetLabel?: string;
  showGroupStageHint?: boolean;
  onScoreChange: (score: EncounterScore) => void;
  onPresetSelect?: (score: EncounterScore) => void;
};

export function EncounterScoreControls({
  idPrefix,
  homeScore,
  awayScore,
  homeLabel = "Home Score",
  awayLabel = "Away Score",
  presetLabel = "Result presets",
  showGroupStageHint = false,
  onScoreChange,
  onPresetSelect,
}: EncounterScoreControlsProps) {
  const selectedPreset = getMatchingScorePreset(homeScore, awayScore);

  const updateHomeScore = (value: string | number) => {
    onScoreChange({ homeScore: clampScoreValue(value), awayScore });
  };

  const updateAwayScore = (value: string | number) => {
    onScoreChange({ homeScore, awayScore: clampScoreValue(value) });
  };

  const applyPreset = (score: EncounterScore) => {
    if (onPresetSelect) {
      onPresetSelect(score);
      return;
    }

    onScoreChange(score);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
            Match score
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">
            {showGroupStageHint ? "Group-stage quick results" : "Manual result entry"}
          </p>
        </div>
        <div
          className="rounded-md border border-border/60 bg-background/70 px-3 py-1.5 text-lg font-semibold tabular-nums"
          aria-label={`Current score ${homeScore} to ${awayScore}`}
        >
          {homeScore} - {awayScore}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ScoreStepper
          id={`${idPrefix}-home-score`}
          label={homeLabel}
          value={homeScore}
          onChange={updateHomeScore}
        />
        <ScoreStepper
          id={`${idPrefix}-away-score`}
          label={awayLabel}
          value={awayScore}
          onChange={updateAwayScore}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{presetLabel}</p>
          {selectedPreset ? (
            <span className="text-[11px] text-primary">{selectedPreset.description}</span>
          ) : null}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {GROUP_STAGE_SCORE_PRESETS.map((preset) => {
            const isSelected = selectedPreset?.label === preset.label;

            return (
              <Button
                key={preset.label}
                type="button"
                variant={isSelected ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-9 px-2 font-semibold tabular-nums",
                  !isSelected && "bg-background/60"
                )}
                aria-pressed={isSelected}
                title={preset.description}
                onClick={() =>
                  applyPreset({
                    homeScore: preset.homeScore,
                    awayScore: preset.awayScore,
                  })
                }
              >
                {preset.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type ScoreStepperProps = {
  id: string;
  label: string;
  value: number;
  onChange: (value: string | number) => void;
};

function ScoreStepper({ id, label, value, onChange }: ScoreStepperProps) {
  const decrement = () => onChange(value - 1);
  const increment = () => onChange(value + 1);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex h-10 overflow-hidden rounded-md border border-input bg-background/80 shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <Button
          type="button"
          variant="ghost"
          className="h-full w-10 shrink-0 rounded-r-none border-r border-border/70 px-0"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={decrement}
          disabled={value <= 0}
        >
          <Minus className="size-3.5" />
        </Button>
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-full rounded-none border-0 bg-transparent text-center text-base font-semibold tabular-nums shadow-none focus-visible:ring-0"
          aria-label={label}
        />
        <Button
          type="button"
          variant="ghost"
          className="h-full w-10 shrink-0 rounded-l-none border-l border-border/70 px-0"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={increment}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
