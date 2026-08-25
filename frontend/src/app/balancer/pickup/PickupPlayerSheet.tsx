"use client";

import { ArrowDown, ArrowUp, UserMinus } from "lucide-react";

import { DivisionRankPicker } from "@/app/balancer/components/DivisionRankPicker";
import { splitBattleTag } from "@/app/balancer/components/balancer-page-helpers";
import { CAPTION_CLASS, EYEBROW_CLASS } from "@/app/balancer/pickup/pickup-chrome";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ROLES, ROLE_ACCENTS, ROLE_LABELS } from "@/lib/roles";
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
  onRemove: () => void;
};

/**
 * Per-player mix settings: who plays, which roles, in what priority, at what
 * rank.
 *
 * A sheet rather than an inline expansion because these are the *rare* edits —
 * a lineup row already carries the two frequent ones (bench, toggle a role), and
 * pushing priority and rank overrides into the row would have made every row pay
 * for a control most rows never use.
 */
export function PickupPlayerSheet({
  row,
  canEdit,
  saving,
  onOpenChange,
  onPatch,
  onRemove,
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
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <SheetHeader className="space-y-0 border-b border-[color:var(--aqt-border)] px-5 pb-4 pt-5 text-left">
          <span className={EYEBROW_CLASS}>Advanced settings</span>
          <SheetTitle className="flex items-baseline gap-1.5 pt-1.5 font-display text-xl">
            <span className="truncate">{name}</span>
            {suffix ? (
              <span className="font-mono text-[13px] font-normal text-[color:var(--aqt-fg-faint)]">
                {suffix}
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription className="pt-1 text-[12.5px] text-[color:var(--aqt-fg-dim)]">
            Settings for this mix only. Workspace ranks stay untouched.
          </SheetDescription>
        </SheetHeader>

        {row == null ? null : (
          <div className="flex min-h-0 flex-1 flex-col">
            <section className="flex items-center gap-3 border-b border-[color:var(--aqt-border)] px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-[13.5px] font-medium text-[color:var(--aqt-fg)]">
                  In the balance
                </h3>
                <p className="mt-0.5 text-xs text-[color:var(--aqt-fg-dim)]">
                  Turn off to bench without losing these settings.
                </p>
              </div>
              <Switch
                checked={row.is_active}
                disabled={!canEdit || saving}
                aria-label={`Include ${label} in the balance`}
                onCheckedChange={(checked) => onPatch({ is_active: checked })}
                className="ml-auto h-5 w-[34px] shrink-0 [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-[15px]"
              />
            </section>

            <section className="space-y-2 border-b border-[color:var(--aqt-border)] px-5 py-4">
              <div>
                <h3 className="text-[13.5px] font-medium text-[color:var(--aqt-fg)]">
                  Roles and priority
                </h3>
                <p className="mt-0.5 text-xs text-[color:var(--aqt-fg-dim)]">
                  The balancer fills the top role first and only uses roles that are on.
                </p>
              </div>
              <ul className="space-y-1.5">
                {rolesInView.map((role) => {
                  const position = order.indexOf(role);
                  const isOn = position !== -1;
                  const accent = ROLE_ACCENTS[role];
                  const rank = row.ranks[role];
                  const icon = ROLES.find((item) => item.code === role)?.icon ?? "Support";
                  return (
                    <li
                      key={role}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border px-2.5 py-2",
                        isOn
                          ? "border-[color:var(--aqt-border-2)] bg-white/[0.025]"
                          : "border-[color:var(--aqt-border)]",
                      )}
                    >
                      {/* The number IS the priority — a lit role with no number
                          would leave "which one does the balancer try first?"
                          answerable only by counting down the list. */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-6.5 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold tabular-nums",
                          isOn ? accent.tile : "bg-white/[0.04] text-[color:var(--aqt-fg-faint)]",
                        )}
                      >
                        {isOn ? position + 1 : "\u2013"}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn("shrink-0", isOn ? "opacity-100" : "opacity-30")}
                      >
                        <PlayerRoleIcon role={icon} size={20} decorative />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-[13.5px] font-semibold",
                            isOn
                              ? "text-[color:var(--aqt-fg)]"
                              : "text-[color:var(--aqt-fg-dim)]",
                          )}
                        >
                          {ROLE_LABELS[role]}
                        </span>
                        <span className={cn(CAPTION_CLASS, "block text-[11.5px]")}>
                          {rank == null ? "No rank" : `${rank} pts`}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
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
                        className="size-7 shrink-0"
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
                        className="h-5 w-[34px] shrink-0 [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-[15px]"
                      />
                    </li>
                  );
                })}
              </ul>
              {issue ? (
                <p className="text-xs text-rose-200">{LINEUP_ISSUE_MESSAGES[issue]}</p>
              ) : null}
            </section>

            <section className="space-y-2.5 px-5 py-4">
              <div>
                <h3 className="text-[13.5px] font-medium text-[color:var(--aqt-fg)]">
                  Rank for this mix
                </h3>
                <p className="mt-0.5 text-xs text-[color:var(--aqt-fg-dim)]">
                  Replaces every role rank above, for this mix only. Leave unset to use the
                  workspace ranks.
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <DivisionRankPicker
                  rank={row.rank_value}
                  disabled={!canEdit || saving}
                  label={`Mix rank for ${label}`}
                  onChange={(rank) => onPatch({ rank_value: rank })}
                />
                <span className={cn(CAPTION_CLASS, "flex-1")}>
                  {row.rank_value == null
                    ? "Using workspace ranks"
                    : `${row.rank_value} pts for every role`}
                </span>
                {row.rank_value == null ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0"
                    disabled={!canEdit || saving}
                    onClick={() => onPatch({ rank_value: null })}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </section>

            {canEdit ? (
              <section className="mt-auto border-t border-[color:var(--aqt-border)] px-5 py-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  className="h-8 text-[color:var(--aqt-fg-muted)] hover:border-[color:color-mix(in_srgb,var(--aqt-rose)_40%,transparent)] hover:text-rose-200"
                  onClick={onRemove}
                >
                  <UserMinus className="mr-1.5 size-3.5" aria-hidden="true" />
                  {`Remove ${label} from this mix`}
                </Button>
                <p className="mt-2 text-xs text-[color:var(--aqt-fg-dim)]">
                  Drops these settings too. To sit them out for one game, switch off &ldquo;In the
                  balance&rdquo; instead.
                </p>
              </section>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
