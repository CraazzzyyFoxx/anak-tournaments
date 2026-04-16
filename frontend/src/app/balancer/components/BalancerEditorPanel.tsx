import type { RefObject } from "react";

import type { InternalBalancePayload } from "@/types/balancer-admin.types";
import type { DivisionGrid } from "@/types/workspace.types";

import { BalanceEditor } from "@/components/balancer/BalanceEditor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PANEL_CLASS } from "./balancer-page-helpers";
import { BalancerSetupChecklist } from "./BalancerSetupChecklist";
import type { BalanceVariant } from "./workspace-helpers";

type BalancerEditorPanelProps = {
  activeVariant: BalanceVariant | null;
  activeVariantTeamCount: number;
  activeVariantPlayerCount: number;
  balanceEditorRef: RefObject<HTMLDivElement | null>;
  divisionGrid: DivisionGrid;
  selectedPlayerId: number | null;
  collapsedTeamIds: number[];
  poolPlayerCount: number;
  invalidPlayerCount: number;
  canRunBalance: boolean;
  isRunPending: boolean;
  onChangePayload: (payload: InternalBalancePayload) => void;
  onSelectPlayer: (playerId: number | null) => void;
  onToggleTeam: (teamId: number) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onBrowseAvailable: () => void;
  onReviewConflicts: () => void;
  onRunBalance: () => void;
};

export function BalancerEditorPanel({
  activeVariant,
  activeVariantTeamCount,
  activeVariantPlayerCount,
  balanceEditorRef,
  divisionGrid,
  selectedPlayerId,
  collapsedTeamIds,
  poolPlayerCount,
  invalidPlayerCount,
  canRunBalance,
  isRunPending,
  onChangePayload,
  onSelectPlayer,
  onToggleTeam,
  onExpandAll,
  onCollapseAll,
  onBrowseAvailable,
  onReviewConflicts,
  onRunBalance,
}: BalancerEditorPanelProps) {
  return (
    <div className={cn(PANEL_CLASS, "flex min-h-0 flex-1 flex-col p-4")}>
      {activeVariant ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-white/88">
                {activeVariantTeamCount} teams / {activeVariantPlayerCount} players
              </div>
              <div className="text-xs text-white/38">
                Drag players between team slots to tweak the final draft.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl border-white/10 bg-black/15 text-white/70 hover:bg-white/5 hover:text-white"
                onClick={onExpandAll}
                disabled={activeVariantTeamCount === 0}
              >
                Expand all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl border-white/10 bg-black/15 text-white/70 hover:bg-white/5 hover:text-white"
                onClick={onCollapseAll}
                disabled={activeVariantTeamCount === 0}
              >
                Collapse all
              </Button>
            </div>
          </div>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <BalanceEditor
              ref={balanceEditorRef}
              value={activeVariant.payload}
              onChange={onChangePayload}
              divisionGrid={divisionGrid}
              selectedPlayerId={selectedPlayerId}
              onSelectPlayer={onSelectPlayer}
              collapsedTeamIds={collapsedTeamIds}
              onToggleTeam={onToggleTeam}
            />
          </div>
        </>
      ) : (
        <BalancerSetupChecklist
          poolPlayerCount={poolPlayerCount}
          invalidPlayerCount={invalidPlayerCount}
          canRunBalance={canRunBalance}
          isRunPending={isRunPending}
          onBrowseAvailable={onBrowseAvailable}
          onReviewConflicts={onReviewConflicts}
          onRunBalance={onRunBalance}
        />
      )}
    </div>
  );
}
