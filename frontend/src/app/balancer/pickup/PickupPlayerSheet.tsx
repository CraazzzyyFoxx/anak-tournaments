"use client";

import { UserMinus } from "lucide-react";

import { BattleTagCopyButton } from "@/app/balancer/components/BattleTagCopyControls";
import {
  NEUTRAL_RANK_ACCENT,
  ROLE_RANK_ACCENTS,
  RoleRankControls,
  useDebouncedRank
} from "@/app/balancer/components/RoleRankControls";
import { splitBattleTag } from "@/app/balancer/components/balancer-page-helpers";
import { EYEBROW_CLASS } from "@/app/balancer/pickup/pickup-chrome";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import RankHistory from "@/components/RankHistory";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ROLE_LABELS, getRoleIconName, type RoleCode } from "@/lib/roles";
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
  roleOrderByStrength,
  toggleRole,
} from "./pickup-lineup";

type PickupPlayerSheetProps = {
  row: CustomGamePlayer | null;
  canEdit: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (patch: CustomGamePlayerPatch) => void;
  /** `null` clears the host's own rank for that role, falling back to the workspace. */
  onSetAuthorRank: (role: string, rank: number | null) => void;
  onRemove: () => void;
};

/**
 * Per-player mix settings: who plays, which roles, in what priority, at what
 * rank.
 *
 * A sheet rather than an inline expansion because these are the *rare* edits —
 * a lineup row already carries the two frequent ones (bench, toggle a role), and
 * pushing priority and rank editing into the row would have made every row pay
 * for a control most rows never use.
 *
 * There is no per-mix rank pin. One number that overrode every role inside a
 * single mix was invisible from the roster, from the next mix and from every
 * tournament, so the same correction had to be re-typed per game; a rank typed
 * here lands in the host's own book instead, which is the layer that actually
 * follows them.
 *
 * Priority is neither dragged nor stepped — it is not authored at all. It reads
 * off the ranks below (strongest role first), so the only way to change what a
 * player is seated in first is to correct what they are actually worth there.
 * The drag list this replaces was a second, quieter source of truth: it went
 * stale the moment a rank moved, and reconciling the two was work no host asked
 * for.
 *
 * Ranks use `RoleRankControls`, the same number-field-over-division-slider the
 * tournament sheet uses. This sheet used to own a crest-only picker instead, so
 * the two surfaces that edit the same thing disagreed about how: one could type
 * a rating, the other could only pick a division, and neither said so.
 */
export function PickupPlayerSheet({
  row,
  canEdit,
  saving,
  onOpenChange,
  onPatch,
  onSetAuthorRank,
  onRemove,
}: Readonly<PickupPlayerSheetProps>) {
  const label = row ? playerLabel(row) : "";
  const { name, suffix } = splitBattleTag(label);
  const order = row ? roleOrderByStrength(row) : [];
  const issue = row ? getLineupIssue(row) : null;
  const disabled = !canEdit || saving;
  // Off roles trail the selected ones as switched-off candidates, in canonical
  // order: an unselected role has no priority, so ranking them would imply one.
  const offRoles = LINEUP_ROLES.filter((role) => !order.includes(role));

  return (
    <Sheet open={row != null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[640px]"
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
            Bench and roles apply to this mix. A rank goes into your own book, which every mix you
            host reads; the workspace rank stays untouched.
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
                disabled={disabled}
                aria-label={`Include ${label} in the balance`}
                onCheckedChange={(checked) => onPatch({ is_active: checked })}
                className="ml-auto h-5 w-[34px] shrink-0 [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-[15px]"
              />
            </section>

            <section className="space-y-2 border-b border-[color:var(--aqt-border)] px-5 py-4">
              <div>
                <h3 className="text-[13.5px] font-medium text-[color:var(--aqt-fg)]">
                  Roles and ranks
                </h3>
                <p className="mt-0.5 text-xs text-[color:var(--aqt-fg-dim)]">
                  The balancer fills the strongest role first and only uses roles that are on. A
                  rank you type here goes into your own book — yours across every mix you host, and
                  it beats the workspace rank until you clear it.
                </p>
              </div>

              <ul className="space-y-2">
                {order.map((role) => (
                  <li
                    key={role}
                    className={cn(
                      "flex items-start gap-2.5 rounded-xl border bg-white/3 p-2.5 transition-colors",
                      "border-[color:var(--aqt-border-2)]",
                      ROLE_RANK_ACCENTS[role]?.row,
                    )}
                  >
                    <RoleCardBody
                      row={row}
                      role={role}
                      label={label}
                      isOn
                      isPrimary={role === order[0]}
                      disabled={disabled}
                      onToggle={() => onPatch({ roles: toggleRole(row, role) })}
                      onSetAuthorRank={onSetAuthorRank}
                    />
                  </li>
                ))}
              </ul>

              {offRoles.length === 0 ? null : (
                <ul className="space-y-2 pt-0.5">
                  {offRoles.map((role) => (
                    <li
                      key={role}
                      className="flex items-start gap-2.5 rounded-xl border border-[color:var(--aqt-border)] bg-white/2 p-2.5 opacity-80"
                    >
                      <RoleCardBody
                        row={row}
                        role={role}
                        label={label}
                        isOn={false}
                        isPrimary={false}
                        disabled={disabled}
                        onToggle={() => onPatch({ roles: toggleRole(row, role) })}
                        onSetAuthorRank={onSetAuthorRank}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {issue ? (
                <p className="text-xs text-rose-200">{LINEUP_ISSUE_MESSAGES[issue]}</p>
              ) : null}
            </section>

            {/* The one thing the mix cannot tell the host: what this player is
                actually ranked in Overwatch right now. Read-only, and the same
                component the tournament sheet uses. */}
            <section className="space-y-2 px-5 py-4">
              <Label className="text-xs font-medium text-[color:var(--aqt-fg)]">
                Live rank (OverFast)
              </Label>
              <div className="rounded-lg border border-[color:var(--aqt-border-2)] bg-white/[0.03] p-2.5">
                <RankHistory battleTag={row.battle_tag} />
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

/**
 * One role's card: name, first-choice mark, on/off, and the shared rank controls.
 *
 * The field edits the *effective* rank — what balance will actually use — rather
 * than only this host's own entry, because a host reads the number they see and
 * expects to be able to correct it. Typing stores the corrected value in their
 * own book; Clear drops that entry and the field falls back to whatever the
 * workspace (or Overwatch) says, which the badge names.
 */
function RoleCardBody({
  row,
  role,
  label,
  isOn,
  isPrimary,
  disabled,
  onToggle,
  onSetAuthorRank,
}: Readonly<{
  row: CustomGamePlayer;
  role: RoleCode;
  label: string;
  isOn: boolean;
  /** The strongest selected role — where the balancer will try to seat them first. */
  isPrimary: boolean;
  disabled: boolean;
  onToggle: () => void;
  onSetAuthorRank: (role: string, rank: number | null) => void;
}>) {
  const accent = ROLE_RANK_ACCENTS[role] ?? NEUTRAL_RANK_ACCENT;
  const mine = row.author_ranks[role] ?? null;
  const source = row.rank_sources[role] ?? null;
  const rank = useDebouncedRank(row.ranks[role] ?? null, (next) => onSetAuthorRank(role, next));

  return (
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <PlayerRoleIcon role={getRoleIconName(role)} size={15} decorative />
          <span
            className={cn(
              "text-xs font-semibold",
              isOn ? accent.text : "text-[color:var(--aqt-fg-muted)]",
            )}
          >
            {ROLE_LABELS[role]}
          </span>
          {/* The cards are already ordered strongest-first, so this only names
              what the top of the list means. A number here would re-assert an
              order nobody can edit. */}
          {isPrimary ? (
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-px font-mono text-[11px] font-bold uppercase tracking-[0.12em]",
                accent.chip,
              )}
            >
              First
            </span>
          ) : null}
        </div>

        <div className="flex h-6 items-center gap-1.5 rounded-md border border-[color:var(--aqt-border-2)] bg-black/15 px-2">
          <Switch
            checked={isOn}
            disabled={disabled}
            aria-label={`${ROLE_LABELS[role]} for ${label}`}
            onCheckedChange={onToggle}
            className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
          />
          <span
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wide",
              isOn ? accent.text : "text-[color:var(--aqt-fg-dim)]",
            )}
          >
            {isOn ? "Active" : "Off"}
          </span>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_130px]">
        <RoleRankControls
          rankValue={rank.value}
          sourceLabel={source ? RANK_SOURCE_LABELS[source] : null}
          accent={accent}
          active={isOn}
          disabled={disabled}
          onClear={mine == null ? null : () => rank.commitNow(null)}
          onChange={(next) => rank.set(next)}
        />
      </div>
    </div>
  );
}
