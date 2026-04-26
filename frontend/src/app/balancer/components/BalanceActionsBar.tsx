import {
  AlertCircle,
  BarChart2,
  Camera,
  Check,
  Copy,
  Download,
  Loader2,
  Shuffle,
  Sparkles,
  Upload,
  UserX
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { InternalBalancePayload } from "@/types/balancer-admin.types";
import { MUTED_BUTTON_CLASS } from "./balancer-page-helpers";

type VariantStats = {
  mmr_std_dev?: number | null;
  off_role_count?: number | null;
  sub_role_collision_count?: number | null;
  unbalanced_count?: number | null;
  composite_score?: number | null;
  balance_objective?: number | null;
  comfort_objective?: number | null;
  balance_objective_norm?: number | null;
  comfort_objective_norm?: number | null;
} | null;

type BalanceActionsBarProps = {
  activeVariantStats: VariantStats;
  activeVariant: { payload: InternalBalancePayload } | null;
  canRunBalance: boolean;
  isSavePending: boolean;
  isExportPending: boolean;
  onRunBalance: () => void;
  onSaveBalance: () => void;
  onExportBalance: () => void;
  onDownloadJson: () => void;
  onCopyNames: () => void;
  onScreenshot: () => void;
};

export function BalanceActionsBar({
  activeVariantStats,
  activeVariant,
  canRunBalance,
  isSavePending,
  isExportPending,
  onRunBalance,
  onSaveBalance,
  onExportBalance,
  onDownloadJson,
  onCopyNames,
  onScreenshot
}: BalanceActionsBarProps) {
  return (
    <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-2">
        {activeVariantStats?.mmr_std_dev != null ? (
          <Badge className="rounded-full border-blue-400/20 bg-blue-500/10 text-blue-200 hover:bg-blue-500/10">
            <BarChart2 className="mr-1.5 h-3.5 w-3.5" />
            StdDev {activeVariantStats.mmr_std_dev.toFixed(1)}
          </Badge>
        ) : null}
        {activeVariantStats?.off_role_count != null ? (
          <Badge className="rounded-full border-orange-400/20 bg-orange-500/10 text-orange-200 hover:bg-orange-500/10">
            <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
            Off-role {activeVariantStats.off_role_count}
          </Badge>
        ) : null}
        {activeVariantStats?.sub_role_collision_count != null ? (
          <Badge className="rounded-full border-violet-400/20 bg-violet-500/10 text-violet-200 hover:bg-violet-500/10">
            <Shuffle className="mr-1.5 h-3.5 w-3.5" />
            Collisions {activeVariantStats.sub_role_collision_count}
          </Badge>
        ) : null}
        {activeVariantStats?.unbalanced_count != null ? (
          <Badge className="rounded-full border-rose-400/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/10">
            <UserX className="mr-1.5 h-3.5 w-3.5" />
            Benched {activeVariantStats.unbalanced_count}
          </Badge>
        ) : null}
        {activeVariantStats?.composite_score != null ? (
          <Badge
            title={`balance=${activeVariantStats.balance_objective_norm?.toFixed(3) ?? activeVariantStats.balance_objective?.toFixed(3) ?? "—"} comfort=${activeVariantStats.comfort_objective_norm?.toFixed(3) ?? activeVariantStats.comfort_objective?.toFixed(3) ?? "—"} (normalized 0..1)`}
            className="rounded-full border-emerald-400/20 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/10"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Quality {activeVariantStats.composite_score.toFixed(2)}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
          onClick={onRunBalance}
          disabled={!canRunBalance || isExportPending}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Regenerate
        </Button>
        <Button
          type="button"
          className="rounded-xl bg-violet-500 text-white hover:bg-violet-400"
          onClick={onSaveBalance}
          disabled={!activeVariant || isSavePending || isExportPending}
        >
          {isSavePending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
          onClick={onExportBalance}
          disabled={!activeVariant || isExportPending || isSavePending}
        >
          {isExportPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Export to Tournament
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
          onClick={onDownloadJson}
          disabled={!activeVariant}
        >
          <Download className="mr-2 h-4 w-4" />
          Download JSON
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
          onClick={onCopyNames}
          disabled={!activeVariant}
        >
          <Copy className="mr-2 h-4 w-4" />
          Copy
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
          onClick={onScreenshot}
          disabled={!activeVariant}
        >
          <Camera className="mr-2 h-4 w-4" />
          Image
        </Button>
      </div>
    </div>
  );
}
