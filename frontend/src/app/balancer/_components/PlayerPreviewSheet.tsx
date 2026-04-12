"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import type { BalancerPlayerRecord, AdminRegistration, InternalBalancePayload } from "@/types/balancer-admin.types";
import { ROLE_LABELS, getActiveRoleEntries } from "./workspace-helpers";
import { MUTED_BUTTON_CLASS, ROLE_ACCENTS, formatSubtypeLabel, splitBattleTag, findPlayerAssignment } from "./balancer-page-helpers";
import type { PlayerValidationState } from "./balancer-page-helpers";
import { Users } from "lucide-react";

type PlayerPreviewSheetProps = {
  selectedPlayer: BalancerPlayerRecord | null;
  selectedRegistration: AdminRegistration | null;
  allPlayerValidationStates: PlayerValidationState[];
  activeVariantPayload: InternalBalancePayload | null;
  onClose: () => void;
  onEditPlayer: (playerId: number) => void;
  onTogglePool: (player: BalancerPlayerRecord) => void;
  isRemovePending: boolean;
  isIncludePending: boolean;
};

export function PlayerPreviewSheet({
  selectedPlayer,
  selectedRegistration,
  allPlayerValidationStates,
  activeVariantPayload,
  onClose,
  onEditPlayer,
  onTogglePool,
  isRemovePending,
  isIncludePending,
}: PlayerPreviewSheetProps) {
  const selectedBattleTag = selectedPlayer ? splitBattleTag(selectedPlayer.battle_tag) : null;
  const selectedPlayerRoleEntries = selectedPlayer
    ? getActiveRoleEntries(selectedPlayer.role_entries_json)
    : [];

  const selectedPlayerIssues = useMemo(
    () =>
      selectedPlayer != null
        ? (allPlayerValidationStates.find((s) => s.player.id === selectedPlayer.id)?.issues ?? [])
        : [],
    [allPlayerValidationStates, selectedPlayer],
  );

  const selectedPlayerAssignment = useMemo(
    () => findPlayerAssignment(activeVariantPayload, selectedPlayer?.id ?? null),
    [activeVariantPayload, selectedPlayer?.id],
  );

  const selectedPlayerAverageRank = useMemo(() => {
    if (!selectedPlayer) return null;
    const roleEntries = getActiveRoleEntries(selectedPlayer.role_entries_json);
    const rankValues = roleEntries
      .map((e) => e.rank_value)
      .filter((v): v is number => v !== null);
    if (rankValues.length === 0) return null;
    return Math.round(rankValues.reduce((sum, v) => sum + v, 0) / rankValues.length);
  }, [selectedPlayer]);

  return (
    <Sheet open={selectedPlayer != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full border-white/8 bg-[#11101f] p-0 text-white shadow-[0_24px_90px_rgba(0,0,0,0.42)] sm:max-w-[420px]"
      >
        {selectedPlayer ? (
          <>
            <div className="border-b border-white/8 p-4 pr-14">
              <SheetTitle className="sr-only">
                {selectedBattleTag?.name ?? selectedPlayer.battle_tag}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Player preview with registration status, role profile, notes, and pool actions.
              </SheetDescription>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <h2 className="truncate text-xl font-semibold text-white/92">
                      {selectedBattleTag?.name ?? selectedPlayer.battle_tag}
                    </h2>
                    {selectedBattleTag?.suffix ? (
                      <span className="shrink-0 text-sm text-white/28">{selectedBattleTag.suffix}</span>
                    ) : null}
                  </div>
                  {selectedRegistration?.display_name &&
                  selectedRegistration.display_name !== selectedPlayer.battle_tag ? (
                    <p className="mt-1 text-sm text-white/38">{selectedRegistration.display_name}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className="rounded-full border-white/10 bg-white/[0.05] text-white/72 hover:bg-white/[0.05]">
                      {selectedRegistration?.source === "google_sheets" ? "Google Sheets" : "Manual"}
                    </Badge>
                    <Badge
                      className={cn(
                        "rounded-full hover:bg-transparent",
                        selectedRegistration?.status === "approved"
                          ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                          : selectedRegistration?.status === "rejected"
                            ? "border-rose-400/20 bg-rose-500/10 text-rose-200"
                            : selectedRegistration?.status === "withdrawn"
                              ? "border-amber-400/20 bg-amber-500/10 text-amber-200"
                              : "border-white/10 bg-white/[0.05] text-white/72",
                      )}
                    >
                      {selectedRegistration?.status
                        ? selectedRegistration.status.charAt(0).toUpperCase() +
                          selectedRegistration.status.slice(1)
                        : "Profile"}
                    </Badge>
                  </div>
                </div>

                <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.08] px-4 py-3 text-right">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/28">Avg SR</div>
                  <div className="mt-1 text-3xl font-semibold text-violet-100">
                    {selectedPlayerAverageRank ?? "-"}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/28">Pool status</div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    className={cn(
                      "rounded-full hover:bg-transparent",
                      selectedPlayer.is_in_pool
                        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                        : "border-rose-400/20 bg-rose-500/10 text-rose-200",
                    )}
                  >
                    {selectedPlayer.is_in_pool ? "In pool" : "Excluded"}
                  </Badge>
                  <span className="text-sm text-white/68">
                    {selectedPlayerAssignment
                      ? `${selectedPlayerAssignment.teamName} / ${selectedPlayerAssignment.roleKey}`
                      : selectedPlayer.is_in_pool
                        ? "Waiting for assignment"
                        : "Hidden from current runs"}
                  </span>
                </div>
              </div>

              {selectedPlayerIssues.length > 0 ? (
                <div className="rounded-2xl border border-amber-400/18 bg-amber-500/[0.08] p-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-amber-100/65">Issues</div>
                  <div className="mt-2 space-y-2">
                    {selectedPlayerIssues.map((issue) => (
                      <div key={`${selectedPlayer.id}-${issue.code}`} className="text-sm text-amber-100/86">
                        {issue.message}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/28">Roles</div>
                {selectedPlayerRoleEntries.length > 0 ? (
                  selectedPlayerRoleEntries.map((entry, index) => {
                    const accent = ROLE_ACCENTS[entry.role];
                    const subtypeLabel = formatSubtypeLabel(entry.subtype);
                    return (
                      <div
                        key={`${selectedPlayer.id}-${entry.role}-${index}`}
                        className={cn("rounded-2xl border p-3", accent.card)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="shrink-0 opacity-95">
                              <PlayerRoleIcon role={ROLE_LABELS[entry.role]} size={18} />
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{ROLE_LABELS[entry.role]}</div>
                              {subtypeLabel ? (
                                <div className="text-xs opacity-70">{subtypeLabel}</div>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {entry.division_number != null ? (
                              <PlayerDivisionIcon division={entry.division_number} width={22} height={22} />
                            ) : null}
                            <span className="text-sm font-semibold tabular-nums">
                              {entry.rank_value ?? "-"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-white/40">
                    No active roles configured.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/28">Flexibility</div>
                <div className="mt-2 text-sm text-white/78">
                  {selectedPlayer.is_flex ? "Flex player" : "Strict roles"}
                </div>
              </div>

              {(selectedRegistration?.admin_notes ?? selectedPlayer.admin_notes) ? (
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/28">Admin notes</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-white/74">
                    {selectedRegistration?.admin_notes ?? selectedPlayer.admin_notes}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-white/8 p-4">
              <div className="space-y-2">
                <Button
                  type="button"
                  className="w-full rounded-xl bg-violet-500 text-white hover:bg-violet-400"
                  onClick={() => onEditPlayer(selectedPlayer.id)}
                >
                  Edit player
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={cn("w-full rounded-xl", MUTED_BUTTON_CLASS)}
                  onClick={() => onTogglePool(selectedPlayer)}
                  disabled={isRemovePending || isIncludePending}
                >
                  {selectedPlayer.is_in_pool ? "Remove from pool" : "Return to pool"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/8 bg-black/15">
              <Users className="h-6 w-6 text-white/36" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-white/88">Select a player</p>
              <p className="text-xs text-white/40">
                Choose a registration from the pool or a team card to inspect it here.
              </p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
