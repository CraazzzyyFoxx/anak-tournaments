"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import { DivisionRankPicker } from "@/app/balancer/components/DivisionRankPicker";
import { splitBattleTag } from "@/app/balancer/components/balancer-page-helpers";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ROLE_ACCENTS, ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { CustomGamePlayer, CustomGamePlayerPatch } from "@/services/custom-game.service";

import {
  LINEUP_ISSUE_MESSAGES,
  LINEUP_ROLES,
  getLineupIssue,
  moveRole,
  playerLabel,
  resolveRoleOrder,
  toggleRole,
} from "./pickup-lineup";

type PickupPlayerSheetProps = {
  row: CustomGamePlayer | null;
  canEdit: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (patch: CustomGamePlayerPatch) => void;
};

/**
 * Per-player mix settings: who plays, which roles, in what priority, at what
 * rank. A deliberately small sibling of the tournament balancer's player sheet
 * — a pickup host tunes participation, not a registration profile, so there is
 * no history, no sub-roles and no status workflow here.
 */
export function PickupPlayerSheet({
  row,
  canEdit,
  saving,
  onOpenChange,
  onPatch,
}: Readonly<PickupPlayerSheetProps>) {
  const label = row ? playerLabel(row) : "";
  const { name, suffix } = splitBattleTag(label);
  const order = row ? resolveRoleOrder(row) : [];
  // Selected roles first, in the host's priority order, then the rest as
  // switched-off candidates, so the list never reshuffles unpredictably.
  const rolesInView = [...order, ...LINEUP_ROLES.filter((role) => !order.includes(role))];
  const issue = row ? getLineupIssue(row) : null;

  return (
    <Sheet open={row != null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="space-y-1">
          <SheetTitle className="flex items-baseline gap-1">
            <span className="truncate">{name}</span>
            {suffix ? <span className="text-sm font-normal text-muted-foreground">{suffix}</span> : null}
          </SheetTitle>
          <SheetDescription>
            Settings for this mix only. Workspace ranks stay untouched.
          </SheetDescription>
        </SheetHeader>

        {row == null ? null : (
          <div className="mt-6 space-y-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">In the balance</h3>
                  <p className="text-xs text-muted-foreground">
                    Turn off to bench without losing these settings.
                  </p>
                </div>
                <Switch
                  checked={row.is_active}
                  disabled={!canEdit || saving}
                  aria-label={`Include ${label} in the balance`}
                  onCheckedChange={(checked) => onPatch({ is_active: checked })}
                />
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-medium">Roles and priority</h3>
                <p className="text-xs text-muted-foreground">
                  The balancer fills the top role first and only uses roles that are on.
                </p>
              </div>
              <ul className="space-y-1.5">
                {rolesInView.map((role) => {
                  const position = order.indexOf(role);
                  const isOn = position !== -1;
                  const accent = ROLE_ACCENTS[role];
                  const rank = row.ranks[role];
                  return (
                    <li
                      key={role}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                        isOn ? "border-[color:var(--aqt-border-2)] bg-white/[0.03]" : "border-border/50",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums",
                          isOn ? accent.tile : "bg-white/[0.04] text-muted-foreground",
                        )}
                      >
                        {isOn ? position + 1 : "\u2013"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{ROLE_LABELS[role]}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">
                          {rank == null ? "No rank" : `${rank} pts`}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={!canEdit || saving || !isOn || position === 0}
                        onClick={() => onPatch({ roles: moveRole(order, role, -1) })}
                      >
                        <ArrowUp className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">{`Raise ${ROLE_LABELS[role]} priority for ${label}`}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={!canEdit || saving || !isOn || position === order.length - 1}
                        onClick={() => onPatch({ roles: moveRole(order, role, 1) })}
                      >
                        <ArrowDown className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">{`Lower ${ROLE_LABELS[role]} priority for ${label}`}</span>
                      </Button>
                      <Switch
                        checked={isOn}
                        disabled={!canEdit || saving}
                        aria-label={`${ROLE_LABELS[role]} for ${label}`}
                        onCheckedChange={() => onPatch({ roles: toggleRole(order, role) })}
                      />
                    </li>
                  );
                })}
              </ul>
              {issue ? <p className="text-xs text-rose-200">{LINEUP_ISSUE_MESSAGES[issue]}</p> : null}
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-medium">Rank for this mix</h3>
                <p className="text-xs text-muted-foreground">
                  Replaces every role rank above, for this mix only. Leave unset to use the
                  workspace ranks.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <DivisionRankPicker
                  rank={row.rank_value}
                  disabled={!canEdit || saving}
                  label={`Mix rank for ${label}`}
                  onChange={(rank) => onPatch({ rank_value: rank })}
                />
                <span className="flex-1 text-xs tabular-nums text-muted-foreground">
                  {row.rank_value == null ? "Using workspace ranks" : `${row.rank_value} pts for every role`}
                </span>
                {row.rank_value == null ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canEdit || saving}
                    onClick={() => onPatch({ rank_value: null })}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
