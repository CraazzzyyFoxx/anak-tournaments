import { cn } from "@/lib/utils";

import { BalanceActionsBar } from "./BalanceActionsBar";
import { PANEL_CLASS } from "./balancer-page-helpers";
import { downloadPayload, type BalanceVariant } from "./workspace-helpers";

type BalancerActionsPanelProps = {
  activeVariant: BalanceVariant | null;
  hasSavedBalance: boolean;
  canRunBalance: boolean;
  isRunPending: boolean;
  isSavePending: boolean;
  isExportPending: boolean;
  isImportPending: boolean;
  tournamentId: number;
  onRunBalance: () => void;
  onSaveBalance: () => void;
  onExportBalance: () => void;
  onCopyNames: () => void;
  onImportTeams: (file: File) => void;
  onScreenshot: () => void;
};

export function BalancerActionsPanel({
  activeVariant,
  hasSavedBalance,
  canRunBalance,
  isRunPending,
  isSavePending,
  isExportPending,
  isImportPending,
  tournamentId,
  onRunBalance,
  onSaveBalance,
  onExportBalance,
  onCopyNames,
  onImportTeams,
  onScreenshot,
}: BalancerActionsPanelProps) {
  if (!activeVariant) {
    return null;
  }

  return (
    <div className={cn(PANEL_CLASS)}>
      <BalanceActionsBar
        activeVariantStats={activeVariant.payload.statistics ?? null}
        activeVariant={activeVariant}
        hasSavedBalance={hasSavedBalance}
        canRunBalance={canRunBalance}
        isRunPending={isRunPending}
        isSavePending={isSavePending}
        isExportPending={isExportPending}
        isImportPending={isImportPending}
        onRunBalance={onRunBalance}
        onSaveBalance={onSaveBalance}
        onExportBalance={onExportBalance}
        onDownloadJson={() => downloadPayload(activeVariant.payload, tournamentId)}
        onCopyNames={onCopyNames}
        onImportTeams={onImportTeams}
        onScreenshot={onScreenshot}
      />
    </div>
  );
}
