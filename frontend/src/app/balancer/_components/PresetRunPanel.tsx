import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { PANEL_CLASS, PRESET_LABELS } from "./balancer-page-helpers";

type PresetRunPanelProps = {
  presetOptions: string[];
  selectedPreset: string;
  onSelectPreset: (preset: string) => void;
  invalidPlayerCount: number;
  excludeInvalidPlayers: boolean;
  onExcludeInvalidPlayersChange: (value: boolean) => void;
  canRunBalance: boolean;
  onRunBalance: () => void;
  isRunPending: boolean;
  jobStatus: string | null;
  jobMessage: string | null;
  jobProgress: number | null;
};

export function PresetRunPanel({
  presetOptions,
  selectedPreset,
  onSelectPreset,
  invalidPlayerCount,
  excludeInvalidPlayers,
  onExcludeInvalidPlayersChange,
  canRunBalance,
  onRunBalance,
  isRunPending,
  jobStatus,
  jobMessage,
  jobProgress,
}: PresetRunPanelProps) {
  return (
    <div className={cn(PANEL_CLASS, "px-4 py-3")}>
      <div className="flex flex-col gap-3">
        {/* Preset chips + Run button */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {presetOptions.map((preset) => {
              const isSelected = preset === selectedPreset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onSelectPreset(preset)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-sm transition",
                    isSelected
                      ? "border-violet-400/40 bg-violet-500/14 text-white"
                      : "border-white/8 bg-white/2 text-white/58 hover:bg-white/5 hover:text-white",
                  )}
                >
                  {PRESET_LABELS[preset] ?? preset}
                </button>
              );
            })}
          </div>

          <Button
            onClick={onRunBalance}
            disabled={!canRunBalance}
            className="ml-auto h-11 rounded-xl bg-violet-500 px-6 text-sm font-semibold text-white hover:bg-violet-400"
          >
            {isRunPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Run balance
          </Button>
        </div>

        {/* Skip invalid players — conditional sub-row */}
        {invalidPlayerCount > 0 ? (
          <div className="flex items-center gap-2 border-t border-white/6 pt-2.5">
            <Switch
              id="exclude-invalid"
              checked={excludeInvalidPlayers}
              onCheckedChange={onExcludeInvalidPlayersChange}
              className="data-[state=checked]:bg-amber-400"
            />
            <label htmlFor="exclude-invalid" className="cursor-pointer text-xs text-amber-100/82">
              Skip {invalidPlayerCount} invalid player{invalidPlayerCount !== 1 ? "s" : ""}
            </label>
          </div>
        ) : null}

        {/* Job status */}
        {jobStatus ? (
          <div className="rounded-xl border border-white/8 bg-black/15 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-white/88">Balance job</div>
                {jobMessage ? <div className="text-xs text-white/40">{jobMessage}</div> : null}
              </div>
              <Badge
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize",
                  jobStatus === "failed"
                    ? "border-red-400/20 bg-red-500/10 text-red-200"
                    : jobStatus === "succeeded"
                      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                      : "border-white/10 bg-white/4 text-white/70",
                )}
              >
                {jobStatus}
              </Badge>
            </div>
            {jobProgress !== null ? (
              <Progress value={jobProgress} className="mt-3 h-2 bg-white/8" />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
