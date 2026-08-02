import { Camera, Check, Copy, Download, Loader2, MoreHorizontal, Sparkles, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import type { InternalBalancePayload } from "@/types/balancer-admin.types";
import { MUTED_BUTTON_CLASS } from "./balancer-page-helpers";
import { BalanceStatsRow, type VariantStats } from "./BalanceStatsRow";

type BalanceActionsBarProps = {
  activeVariantStats: VariantStats;
  activeVariant: { payload: InternalBalancePayload } | null;
  canRunBalance: boolean;
  isSavePending: boolean;
  isExportPending: boolean;
  /** Active variant is exactly the persisted balance — nothing new to save. */
  isBalanceSaved: boolean;
  /** That persisted balance is already exported to tournament teams. */
  isBalanceExported: boolean;
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
  isBalanceSaved,
  isBalanceExported,
  onRunBalance,
  onSaveBalance,
  onExportBalance,
  onDownloadJson,
  onCopyNames,
  onScreenshot
}: BalanceActionsBarProps) {
  return (
    <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
      <BalanceStatsRow stats={activeVariantStats} />

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
          className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={onSaveBalance}
          title={
            isBalanceSaved
              ? "This balance is already saved — edit the rosters or generate a new variant to save again."
              : undefined
          }
          disabled={!activeVariant || isBalanceSaved || isSavePending || isExportPending}
        >
          {isSavePending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          {isBalanceSaved ? "Saved" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
          onClick={onExportBalance}
          title={
            isBalanceExported
              ? "This balance is already exported — edit the rosters or generate a new variant to export again."
              : undefined
          }
          disabled={!activeVariant || isBalanceExported || isExportPending || isSavePending}
        >
          {isExportPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {isBalanceExported ? "Exported" : "Export to Tournament"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn("rounded-xl", MUTED_BUTTON_CLASS)}
              disabled={!activeVariant}
            >
              <MoreHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
              Advanced
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onDownloadJson}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Download JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopyNames}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy names
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onScreenshot}>
              <Camera className="h-4 w-4" aria-hidden="true" />
              Save as image
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
