import { useRef } from "react";
import {
  AlertCircle,
  BarChart2,
  Camera,
  Check,
  Copy,
  Download,
  FolderInput,
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
  mmrStdDev?: number | null;
  offRoleCount?: number | null;
  subRoleCollisionCount?: number | null;
  unbalancedCount?: number | null;
} | null;

type BalanceActionsBarProps = {
  activeVariantStats: VariantStats;
  activeVariant: { payload: InternalBalancePayload } | null;
  hasSavedBalance: boolean;
  canRunBalance: boolean;
  isRunPending: boolean;
  isSavePending: boolean;
  isExportPending: boolean;
  isImportPending: boolean;
  onRunBalance: () => void;
  onSaveBalance: () => void;
  onExportBalance: () => void;
  onDownloadJson: () => void;
  onCopyNames: () => void;
  onImportTeams: (file: File) => void;
  onScreenshot: () => void;
};

export function BalanceActionsBar({
  activeVariantStats,
  activeVariant,
  hasSavedBalance,
  canRunBalance,
  isRunPending,
  isSavePending,
  isExportPending,
  isImportPending,
  onRunBalance,
  onSaveBalance,
  onExportBalance,
  onDownloadJson,
  onCopyNames,
  onImportTeams,
  onScreenshot
}: BalanceActionsBarProps) {
  const importFileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-2">
        {activeVariantStats?.mmrStdDev != null ? (
          <Badge className="rounded-full border-blue-400/20 bg-blue-500/10 text-blue-200 hover:bg-blue-500/10">
            <BarChart2 className="mr-1.5 h-3.5 w-3.5" />
            StdDev {activeVariantStats.mmrStdDev.toFixed(1)}
          </Badge>
        ) : null}
        {activeVariantStats?.offRoleCount != null ? (
          <Badge className="rounded-full border-orange-400/20 bg-orange-500/10 text-orange-200 hover:bg-orange-500/10">
            <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
            Off-role {activeVariantStats.offRoleCount}
          </Badge>
        ) : null}
        {activeVariantStats?.subRoleCollisionCount != null ? (
          <Badge className="rounded-full border-violet-400/20 bg-violet-500/10 text-violet-200 hover:bg-violet-500/10">
            <Shuffle className="mr-1.5 h-3.5 w-3.5" />
            Collisions {activeVariantStats.subRoleCollisionCount}
          </Badge>
        ) : null}
        {activeVariantStats?.unbalancedCount != null ? (
          <Badge className="rounded-full border-rose-400/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/10">
            <UserX className="mr-1.5 h-3.5 w-3.5" />
            Benched {activeVariantStats.unbalancedCount}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
          onClick={onRunBalance}
          disabled={!canRunBalance}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Regenerate
        </Button>
        <Button
          type="button"
          className="rounded-xl bg-violet-500 text-white hover:bg-violet-400"
          onClick={onSaveBalance}
          disabled={!activeVariant || isSavePending}
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
          disabled={!hasSavedBalance || isExportPending}
        >
          {isExportPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Export
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
          onClick={onDownloadJson}
          disabled={!activeVariant}
        >
          <Download className="mr-2 h-4 w-4" />
          JSON
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
        <input
          ref={importFileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportTeams(file);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
          onClick={() => importFileRef.current?.click()}
          disabled={isImportPending}
        >
          {isImportPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FolderInput className="mr-2 h-4 w-4" />
          )}
          Import
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
