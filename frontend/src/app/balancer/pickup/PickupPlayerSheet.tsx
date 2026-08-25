"use client";

import { UserMinus } from "lucide-react";

import { DivisionRankPicker } from "@/app/balancer/components/DivisionRankPicker";
import { BattleTagCopyButton } from "@/app/balancer/components/BattleTagCopyControls";
import { SortableRow, SortableRows } from "@/app/balancer/components/SortableRows";
import { splitBattleTag } from "@/app/balancer/components/balancer-page-helpers";
import { CAPTION_CLASS, EYEBROW_CLASS } from "@/app/balancer/pickup/pickup-chrome";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import RankHistory from "@/components/RankHistory";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ROLES, ROLE_ACCENTS, ROLE_LABELS, type RoleCode } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  RANK_SOURCE_LABELS,
  type CustomGamePlayer,
  type CustomGamePlayerPatch,
} from "@/services/custom-game.service";

import {
  LINEUP_ISSUE_MESSAGES,
  LINEUP_ROLES,
  getLineupIssue,
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
  /** `null` clears the host's own rank for that role. */
  onSetHostRank: (role: string, rank: number | null) => void;
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
 *
 * Priority is dragged, not stepped. Two arrow buttons per role meant reordering
 * three roles took up to four clicks and never showed the order as a shape; the
 * list is short enough that grabbing a row is both faster and self-explanatory,
 * and the shared `SortableRows` keeps the keyboard path the tournament sheet
 * already had.
 */
export function PickupPlayerSheet({
  row,
  canEdit,
  saving,
  onOpenChange,
  onPatch,
  onSetHostRank,
  onRemove,
}: Readonly<PickupPlayerSheetProps>) {
  const label = row ? playerLabel(row) : "";
  const { name, suffix } = splitBattleTag(label);
  const order = row ? resolveRoleOrder(row) : [];
  const issue = row ? getLineupIssue(row) : null;
  // Off roles trail the selected ones as switched-off candidates, and they are
  // not draggable: an unselected role has no priority to place.
  const offRoles = LINEUP_ROLES.filter((role) => !order.includes(role));

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
            {row?.battle_tag ? (
              <BattleTagCopyButton battleTag={row.battle_tag} className="ml-0.5 shrink-0" />
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
                  Drag to reorder. The balancer fills the top role first and only uses roles that
                  are on.
                </p>
              </div>

              <SortableRows
                items={order}
                getId={(role) => role}
                onReorder={(next) => onPatch({ roles: next })}
                className="space-y-1.5"
              >
                {(role, index) => (
                  <SortableRow
                    key={role}
                    id={role}
                    disabled={!canEdit || saving}
                    handleLabel={`Reorder ${ROLE_LABELS[role]} for ${label}`}
                    className="flex items-center gap-2.5 rounded-lg border border-[color:var(--aqt-border-2)] bg-white/[0.025] px-2.5 py-2"
                  >
                    <RoleRow
                      role={role}
                      label={label}
                      position={index}
                      rank={row.ranks[role]}
                      isOn
                      disabled={!canEdit || saving}
                      onToggle={() => onPatch({ roles: toggleRole(order, role) })}
                    />
                  </SortableRow>
                )}
              </SortableRows>

              {offRoles.length === 0 ? null : (
                <ul className="space-y-1.5 pt-1.5">
                  {offRoles.map((role) => (
                    <li
                      key={role}
                      // `pl-8.5` lines the icon up with the dragged rows above,
                      // whose grip handle occupies that width.
                      className="flex items-center gap-2.5 rounded-lg border border-[color:var(--aqt-border)] py-2 pl-[34px] pr-2.5"
                    >
                      <RoleRow
                        role={role}
                        label={label}
                        position={null}
                        rank={row.ranks[role]}
                        isOn={false}
                        disabled={!canEdit || saving}
                        onToggle={() => onPatch({ roles: toggleRole(order, role) })}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {issue ? (
                <p className="text-xs text-rose-200">{LINEUP_ISSUE_MESSAGES[issue]}</p>
              ) : null}
            </section>

            <section className="space-y-2.5 border-b border-[color:var(--aqt-border)] px-5 py-4">
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

            {/* The user-scope dictionary. A mix resolves a rank as
                override > this host's book > workspace canon > Overwatch, so this
                is where "my read of this player" lives without touching what the
                workspace agreed on. Per role, unlike the mix override above,
                because disagreeing about one role is the common case. */}
            <section className="space-y-2.5 border-b border-[color:var(--aqt-border)] px-5 py-4">
              <div>
                <h3 className="text-[13.5px] font-medium text-[color:var(--aqt-fg)]">My ranks</h3>
                <p className="mt-0.5 text-xs text-[color:var(--aqt-fg-dim)]">
                  Yours alone, across every mix you host. Overrides the workspace rank; clear a
                  role to fall back to it.
                </p>
              </div>
              <ul className="space-y-1.5">
                {LINEUP_ROLES.map((role) => {
                  const mine = row.host_ranks[role] ?? null;
                  const effective = row.ranks[role] ?? null;
                  const source = row.rank_sources[role];
                  const icon = ROLES.find((item) => item.code === role)?.icon ?? "Support";
                  return (
                    <li key={role} className="flex items-center gap-2.5">
                      <span className="flex w-24 shrink-0 items-center gap-1.5">
                        <PlayerRoleIcon role={icon} size={15} decorative />
                        <span className="text-[13px] text-[color:var(--aqt-fg-muted)]">
                          {ROLE_LABELS[role]}
                        </span>
                      </span>
                      <DivisionRankPicker
                        rank={mine}
                        disabled={!canEdit || saving}
                        label={`My ${ROLE_LABELS[role]} rank for ${label}`}
                        onChange={(rank) =>
                          onSetHostRank(role, rank)
                        }
                      />
                      <span className={cn(CAPTION_CLASS, "flex-1")}>
                        {mine != null
                          ? `${mine} pts`
                          : effective == null
                            ? "No rank anywhere"
                            : `${effective} from ${RANK_SOURCE_LABELS[source] ?? source}`}
                      </span>
                      {mine == null ? null : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0"
                          disabled={!canEdit || saving}
                          onClick={() => onSetHostRank(role, null)}
                        >
                          Clear
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* The one thing the mix cannot tell the host: what this player is
                actually ranked in Overwatch right now. Read-only, and the same
                component the tournament sheet uses. */}
            <section className="space-y-2.5 px-5 py-4">
              <h3 className="text-[13.5px] font-medium text-[color:var(--aqt-fg)]">
                Live rank (OverFast)
              </h3>
              <RankHistory battleTag={row.battle_tag} />
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

/**
 * The body of one role row, shared by the draggable selected roles and the
 * static off ones so a role reads identically in both lists.
 */
function RoleRow({
  role,
  label,
  position,
  rank,
  isOn,
  disabled,
  onToggle,
}: Readonly<{
  role: RoleCode;
  label: string;
  /** 0-based priority, or `null` when the role is off. */
  position: number | null;
  rank: number | undefined;
  isOn: boolean;
  disabled: boolean;
  onToggle: () => void;
}>) {
  const accent = ROLE_ACCENTS[role];
  const icon = ROLES.find((item) => item.code === role)?.icon ?? "Support";

  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6.5 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold tabular-nums",
          isOn ? accent.tile : "bg-white/[0.04] text-[color:var(--aqt-fg-faint)]",
        )}
      >
        {position == null ? "\u2013" : position + 1}
      </span>
      <span aria-hidden="true" className={cn("shrink-0", isOn ? "opacity-100" : "opacity-30")}>
        <PlayerRoleIcon role={icon} size={20} decorative />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[13.5px] font-semibold",
            isOn ? "text-[color:var(--aqt-fg)]" : "text-[color:var(--aqt-fg-dim)]",
          )}
        >
          {ROLE_LABELS[role]}
        </span>
        <span className={cn(CAPTION_CLASS, "block text-[11.5px]")}>
          {rank == null ? "No rank" : `${rank} pts`}
        </span>
      </span>
      <Switch
        checked={isOn}
        disabled={disabled}
        aria-label={`${ROLE_LABELS[role]} for ${label}`}
        onCheckedChange={onToggle}
        className="h-5 w-[34px] shrink-0 [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-[15px]"
      />
    </>
  );
}
