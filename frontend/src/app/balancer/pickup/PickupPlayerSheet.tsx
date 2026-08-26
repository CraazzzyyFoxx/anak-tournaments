"use client";

import { useEffect, useState } from "react";
import { Save, UserMinus } from "lucide-react";

import { BattleTagCopyButton } from "@/app/balancer/components/BattleTagCopyControls";
import {
  NEUTRAL_RANK_ACCENT,
  ROLE_RANK_ACCENTS,
  RoleRankControls,
} from "@/app/balancer/components/RoleRankControls";
import { SortableGrip, SortableRows, useSortableRow } from "@/app/balancer/components/SortableRows";
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { OW_REFERENCE_GRID } from "@/lib/division-grid";
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
  resolveRoleOrder,
  toggleRole,
} from "./pickup-lineup";

/** What Save writes into the host's own rank book: `clear` falls the role back to the workspace. */
export type PickupRankChange = { ranks: Record<string, number>; clear: string[] };

type PickupPlayerSheetProps = {
  row: CustomGamePlayer | null;
  canEdit: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: CustomGamePlayerPatch, rankChange: PickupRankChange | null) => void;
  onRemove: () => void;
};

/** Everything the sheet edits before Save, kept apart from the server row. */
type RoleDraft = {
  isActive: boolean;
  /** Priority order of the roles that are on — position is what the balancer reads. */
  order: RoleCode[];
  /** Staged writes to the host's own book. A `null` value is a staged Clear. */
  rankEdits: Partial<Record<RoleCode, number | null>>;
};

function buildDraft(row: CustomGamePlayer | null): RoleDraft {
  return {
    isActive: row?.is_active ?? true,
    order: row ? resolveRoleOrder(row) : [],
    rankEdits: {},
  };
}

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
 * Priority is a drag list, like the tournament sheet's: the stored role order
 * *is* the balancer's priority (see `CustomGamePlayer.roles`), so deriving it
 * from a rank instead — the previous design — moved a role's seat the moment
 * any layer's number changed, with no click the host could point at. Dragging
 * makes it what it always was on the wire: a choice the host makes once.
 *
 * Every edit here is staged until Save: closing the sheet any other way (the
 * corner ✕, Escape, an outside click, or Cancel) discards it, the same as the
 * tournament sheet.
 *
 * Ranks use `RoleRankControls`, the same number-field-over-division-slider the
 * tournament sheet uses.
 */
export function PickupPlayerSheet({
  row,
  canEdit,
  saving,
  onOpenChange,
  onSave,
  onRemove,
}: Readonly<PickupPlayerSheetProps>) {
  const label = row ? playerLabel(row) : "";
  const { name, suffix } = splitBattleTag(label);
  const [draft, setDraft] = useState<RoleDraft>(() => buildDraft(row));

  // Keyed on the member id rather than the whole row: a background refetch of
  // this same player (another host's edit landing mid-session) must not wipe
  // out an edit still in progress.
  useEffect(() => {
    setDraft(buildDraft(row));
  }, [row?.workspace_member_id]);

  // Reads the draft, not the server row: a role turned on (or a rank typed
  // for one) must clear this warning immediately, not once Save round-trips.
  const issue = row ? getLineupIssue(draftRow(row, draft)) : null;
  const disabled = !canEdit || saving;
  // Off roles trail the on ones in canonical order: an unselected role has no
  // priority, so ranking them would imply one.
  const offRoles = LINEUP_ROLES.filter((role) => !draft.order.includes(role));

  const toggle = (role: RoleCode) =>
    setDraft((current) => ({ ...current, order: toggleRole(current.order, role) }));

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setDraft(buildDraft(row));
    }
    onOpenChange(open);
  };

  const handleSave = () => {
    if (!row) return;
    const ranks: Record<string, number> = {};
    const clear: string[] = [];
    for (const [role, value] of Object.entries(draft.rankEdits)) {
      if (value == null) {
        clear.push(role);
      } else {
        ranks[role] = value;
      }
    }
    onSave(
      { is_active: draft.isActive, roles: draft.order },
      Object.keys(draft.rankEdits).length > 0 ? { ranks, clear } : null,
    );
  };

  return (
    <Sheet open={row != null} onOpenChange={handleOpenChange}>
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
            {canEdit ? (
              <>
                Bench and roles apply to this mix. A rank goes into your own book, which every mix
                you host reads; the workspace rank stays untouched. Nothing here writes until you
                press Save.
              </>
            ) : (
              // Read-only has two causes and they are not interchangeable: a
              // closed mix, or somebody else's. Both end at the same server
              // refusal, and saying so beats a sheet of dead controls.
              <>
                Read-only. Only the host of a mix changes its lineup, and the ranks it balances on
                are theirs — yours decide the mixes you run.
              </>
            )}
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
                checked={draft.isActive}
                disabled={disabled}
                aria-label={`Include ${label} in the balance`}
                onCheckedChange={(checked) => setDraft((current) => ({ ...current, isActive: checked }))}
                className="ml-auto h-5 w-[34px] shrink-0 [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-[15px]"
              />
            </section>

            <section className="space-y-2 border-b border-[color:var(--aqt-border)] px-5 py-4">
              <div>
                <h3 className="text-[13.5px] font-medium text-[color:var(--aqt-fg)]">
                  Roles and ranks
                </h3>
                <p className="mt-0.5 text-xs text-[color:var(--aqt-fg-dim)]">
                  Drag to set who the balancer seats first; it only uses roles that are on. A rank
                  you type here goes into your own book — yours across every mix you host, and it
                  beats the workspace rank until you clear it.
                </p>
              </div>

              <SortableRows
                items={draft.order}
                getId={(role) => role}
                onReorder={(nextOrder) => setDraft((current) => ({ ...current, order: nextOrder }))}
                className="space-y-2"
              >
                {(role, index) => {
                  const field = stagedRankFor(row, draft, role);
                  return (
                    <SortableRoleCard
                      key={role}
                      id={role}
                      role={role}
                      label={label}
                      priority={index + 1}
                      isPrimary={index === 0}
                      disabled={disabled}
                      onToggle={() => toggle(role)}
                      rankValue={field.rankValue}
                      sourceLabel={field.sourceLabel}
                      hasOwnEntry={field.hasOwnEntry}
                      onRankChange={(next) =>
                        setDraft((current) => ({
                          ...current,
                          rankEdits: { ...current.rankEdits, [role]: next },
                        }))
                      }
                      onRankClear={() =>
                        setDraft((current) => ({
                          ...current,
                          rankEdits: { ...current.rankEdits, [role]: null },
                        }))
                      }
                    />
                  );
                }}
              </SortableRows>

              {offRoles.length === 0 ? null : (
                <ul className="space-y-2 pt-0.5">
                  {offRoles.map((role) => {
                    const field = stagedRankFor(row, draft, role);
                    return (
                      <li
                        key={role}
                        className="flex items-start gap-2.5 rounded-xl border border-[color:var(--aqt-border)] bg-white/2 p-2.5 opacity-80"
                      >
                        <RoleCardBody
                          role={role}
                          label={label}
                          isOn={false}
                          isPrimary={false}
                          disabled={disabled}
                          onToggle={() => toggle(role)}
                          rankValue={field.rankValue}
                          sourceLabel={field.sourceLabel}
                          hasOwnEntry={field.hasOwnEntry}
                          onRankChange={(next) =>
                            setDraft((current) => ({
                              ...current,
                              rankEdits: { ...current.rankEdits, [role]: next },
                            }))
                          }
                          onRankClear={() =>
                            setDraft((current) => ({
                              ...current,
                              rankEdits: { ...current.rankEdits, [role]: null },
                            }))
                          }
                        />
                      </li>
                    );
                  })}
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
              <section className="border-t border-[color:var(--aqt-border)] px-5 py-4">
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
                  Drops these settings too, right away. To sit them out for one game, switch off
                  &ldquo;In the balance&rdquo; and press Save instead.
                </p>
              </section>
            ) : null}
          </div>
        )}

        {row != null && canEdit ? (
          <SheetFooter className="shrink-0 border-t border-[color:var(--aqt-border)] px-5 py-2.5 sm:justify-between sm:space-x-0">
            <div className="text-[11px] text-[color:var(--aqt-fg-dim)]">
              Cancel discards bench, roles and ranks changed in this sheet.
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-8 border-[color:var(--aqt-border-2)] bg-black/20 px-3 text-xs text-[color:var(--aqt-fg)] hover:bg-white/5 hover:text-[color:var(--aqt-fg)]"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="h-8 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The server row with every staged edit folded in, for `getLineupIssue`. */
function draftRow(row: CustomGamePlayer, draft: RoleDraft): CustomGamePlayer {
  const ranks = { ...row.ranks };
  for (const [role, value] of Object.entries(draft.rankEdits)) {
    if (value == null) {
      delete ranks[role];
    } else {
      ranks[role] = value;
    }
  }
  return { ...row, is_active: draft.isActive, roles: draft.order, ranks };
}

/** The rank field's value, source badge and clearability, from the server row plus any staged edit. */
function stagedRankFor(
  row: CustomGamePlayer,
  draft: RoleDraft,
  role: RoleCode,
): { rankValue: number | null; sourceLabel: string | null; hasOwnEntry: boolean } {
  const staged = draft.rankEdits[role];
  if (staged !== undefined) {
    return {
      rankValue: staged,
      sourceLabel: staged == null ? null : RANK_SOURCE_LABELS.author,
      hasOwnEntry: staged != null,
    };
  }
  const source = row.rank_sources[role] ?? null;
  return {
    rankValue: row.ranks[role] ?? null,
    sourceLabel: source ? RANK_SOURCE_LABELS[source] : null,
    hasOwnEntry: row.author_ranks[role] != null,
  };
}

/** One role's card, wired to the drag list: grip, then the row's own content. */
function SortableRoleCard({
  id,
  role,
  label,
  priority,
  isPrimary,
  disabled,
  onToggle,
  rankValue,
  sourceLabel,
  hasOwnEntry,
  onRankChange,
  onRankClear,
}: Readonly<{
  id: string;
  role: RoleCode;
  label: string;
  /** The row's position in the drag list, 1-based — what the balancer reads as priority. */
  priority: number;
  isPrimary: boolean;
  disabled: boolean;
  onToggle: () => void;
  rankValue: number | null;
  sourceLabel: string | null;
  hasOwnEntry: boolean;
  onRankChange: (next: number | null) => void;
  onRankClear: () => void;
}>) {
  const { ref, style, handleProps } = useSortableRow(id, disabled);

  return (
    <li
      ref={ref}
      style={style}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border bg-white/3 p-2.5 transition-colors",
        "border-[color:var(--aqt-border-2)]",
        ROLE_RANK_ACCENTS[role]?.row,
      )}
    >
      <div className="flex flex-col items-center gap-1">
        <SortableGrip
          handleProps={handleProps}
          label={`Reorder ${ROLE_LABELS[role]} for ${label}`}
          disabled={disabled}
        />
        <span className="text-[11px] font-semibold text-[color:var(--aqt-fg-dim)]">{`#${priority}`}</span>
      </div>
      <RoleCardBody
        role={role}
        label={label}
        isOn
        isPrimary={isPrimary}
        disabled={disabled}
        onToggle={onToggle}
        rankValue={rankValue}
        sourceLabel={sourceLabel}
        hasOwnEntry={hasOwnEntry}
        onRankChange={onRankChange}
        onRankClear={onRankClear}
      />
    </li>
  );
}

/**
 * One role's card: name, first-choice mark, on/off, and the shared rank controls.
 *
 * The field edits the *effective* rank — what balance will actually use — rather
 * than only this host's own entry, because a host reads the number they see and
 * expects to be able to correct it. Typing stages the corrected value in their
 * own book; Clear stages dropping that entry, so the field falls back to
 * whatever the workspace (or Overwatch) says once Save writes it.
 */
function RoleCardBody({
  role,
  label,
  isOn,
  isPrimary,
  disabled,
  onToggle,
  rankValue,
  sourceLabel,
  hasOwnEntry,
  onRankChange,
  onRankClear,
}: Readonly<{
  role: RoleCode;
  label: string;
  isOn: boolean;
  /** The top of the drag list — where the balancer will try to seat them first. */
  isPrimary: boolean;
  disabled: boolean;
  onToggle: () => void;
  rankValue: number | null;
  sourceLabel: string | null;
  hasOwnEntry: boolean;
  onRankChange: (next: number | null) => void;
  onRankClear: () => void;
}>) {
  const accent = ROLE_RANK_ACCENTS[role] ?? NEUTRAL_RANK_ACCENT;

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
          rankValue={rankValue}
          sourceLabel={sourceLabel}
          accent={accent}
          active={isOn}
          disabled={disabled}
          onClear={hasOwnEntry ? onRankClear : null}
          onChange={onRankChange}
          // The global OW grid: balancer-service resolves a mix's ranks against
          // the grid with `workspace_id=None`, so the value edited here is on
          // the OW scale and a workspace's tiers would mislabel it.
          grid={OW_REFERENCE_GRID}
        />
      </div>
    </div>
  );
}
