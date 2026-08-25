"use client";

import { BattleTagCopyButton } from "@/app/balancer/components/BattleTagCopyControls";
import { splitBattleTag } from "@/app/balancer/components/balancer-page-helpers";
import {
  NEUTRAL_RANK_ACCENT,
  ROLE_RANK_ACCENTS,
  RoleRankControls,
  useDebouncedRank,
} from "@/app/balancer/components/RoleRankControls";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import RankHistory from "@/components/RankHistory";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ROLE_LABELS, ROLES, type RoleCode } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { RankScope, RosterMember } from "@/services/workspace-player.service";

const EYEBROW_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]";

const SCOPE_HINTS: Record<RankScope, string> = {
  workspace:
    "The shared fallback. A tournament or mix uses it only where nobody set their own rank.",
  author:
    "Your own book. It beats the workspace rank in the mixes you host, and only you see it.",
};

type WorkspacePlayerSheetProps = {
  /** `null` closes the sheet — the caller holds the row being edited. */
  member: RosterMember | null;
  /** Which rank layer the controls read and write. */
  scope: RankScope;
  canEdit: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` drops the role from the layer rather than zeroing it. */
  onSaveRank: (role: string, rank: number | null) => void;
};

/**
 * One workspace player's ranks, in the same sheet the tournament pool opens.
 *
 * The roster rows used to carry three crest pickers each, which made the panel
 * a grid of controls nobody could clear — the picker offered divisions and
 * nothing else, so a rank set by mistake was permanent. Editing moved here for
 * the same reason the mix moved it: the frequent action is reading the roster,
 * and the rare one is correcting a number.
 *
 * Everything a tournament registration owns — statuses, pool membership, flex,
 * sub-roles, notes, priorities, apply-from-history — is deliberately absent. A
 * workspace member has no registration to carry any of it. What is left is the
 * part both sheets share: `RoleRankControls`, so all three surfaces that edit a
 * rank agree on how it is typed, sliced and cleared.
 */
export function WorkspacePlayerSheet({
  member,
  scope,
  canEdit,
  saving,
  onOpenChange,
  onSaveRank,
}: Readonly<WorkspacePlayerSheetProps>) {
  const label = member ? member.display_name || member.battle_tag || `#${member.member_id}` : "";
  const { name, suffix } = splitBattleTag(label);

  return (
    <Sheet open={member != null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[560px]"
      >
        <SheetHeader className="space-y-0 border-b border-[color:var(--aqt-border)] px-5 pb-4 pt-5 text-left">
          <span className={EYEBROW_CLASS}>Player ranks</span>
          <SheetTitle className="flex items-baseline gap-1.5 pt-1.5 font-display text-xl">
            <span className="truncate">{name}</span>
            {suffix ? (
              <span className="font-mono text-[13px] font-normal text-[color:var(--aqt-fg-faint)]">
                {suffix}
              </span>
            ) : null}
            {member?.battle_tag ? (
              <BattleTagCopyButton battleTag={member.battle_tag} className="ml-0.5 shrink-0" />
            ) : null}
          </SheetTitle>
          <SheetDescription className="pt-1 text-[12.5px] text-[color:var(--aqt-fg-dim)]">
            {SCOPE_HINTS[scope]}
          </SheetDescription>
        </SheetHeader>

        {member == null ? null : (
          <div className="flex min-h-0 flex-1 flex-col">
            <section className="space-y-2 border-b border-[color:var(--aqt-border)] px-5 py-4">
              <div>
                <h3 className="text-[13.5px] font-medium text-[color:var(--aqt-fg)]">
                  Roles and ranks
                </h3>
                <p className="mt-0.5 text-xs text-[color:var(--aqt-fg-dim)]">
                  A role with no rank is a role the balancer will not seat them in. Clear one to
                  drop it from this layer instead of pinning a number over it.
                </p>
              </div>

              <ul className="space-y-2">
                {ROLES.map((role) => (
                  <li
                    key={role.code}
                    className={cn(
                      "rounded-xl border bg-white/3 p-2.5",
                      "border-[color:var(--aqt-border-2)]",
                      ROLE_RANK_ACCENTS[role.code]?.row,
                    )}
                  >
                    <RoleRankCard
                      member={member}
                      role={role.code}
                      iconName={role.icon}
                      scope={scope}
                      disabled={!canEdit || saving}
                      onSaveRank={onSaveRank}
                    />
                  </li>
                ))}
              </ul>
            </section>

            {/* The one thing the roster cannot tell an organiser: what this
                player is actually ranked in Overwatch right now. Read-only, and
                the same component both other sheets use. */}
            {member.battle_tag ? (
              <section className="space-y-2 px-5 py-4">
                <Label className="text-xs font-medium text-[color:var(--aqt-fg)]">
                  Live rank (OverFast)
                </Label>
                <div className="rounded-lg border border-[color:var(--aqt-border-2)] bg-white/[0.03] p-2.5">
                  <RankHistory battleTag={member.battle_tag} />
                </div>
              </section>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * One role's card: the glyph, the role's name, and the shared rank controls.
 *
 * On the author layer the field edits the *effective* rank — what a mix will
 * actually use — rather than only this author's entry, because an organiser
 * reads the number they see and expects to correct it. Typing stores the
 * correction in their own book; Clear drops that entry and the field falls back
 * to the workspace canon, which the badge names.
 */
function RoleRankCard({
  member,
  role,
  iconName,
  scope,
  disabled,
  onSaveRank,
}: Readonly<{
  member: RosterMember;
  role: RoleCode;
  iconName: string;
  scope: RankScope;
  disabled: boolean;
  onSaveRank: (role: string, rank: number | null) => void;
}>) {
  const accent = ROLE_RANK_ACCENTS[role] ?? NEUTRAL_RANK_ACCENT;
  // Only the author layer inherits: the workspace canon has nothing above it
  // that a roster row can see (Overwatch resolution happens per mix).
  const own = (scope === "author" ? member.author_ranks[role] : member.ranks[role]) ?? null;
  const inherited = scope === "author" && own == null ? (member.ranks[role] ?? null) : null;
  const rank = useDebouncedRank(own ?? inherited, (next) => onSaveRank(role, next));

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-1.5">
        <PlayerRoleIcon role={iconName} size={15} decorative />
        <span className={cn("text-xs font-semibold", accent.text)}>{ROLE_LABELS[role]}</span>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_130px]">
        <RoleRankControls
          rankValue={rank.value}
          sourceLabel={inherited == null ? null : "Workspace"}
          accent={accent}
          active
          disabled={disabled}
          onClear={own == null ? null : () => rank.commitNow(null)}
          onChange={(next) => rank.set(next)}
        />
      </div>
    </div>
  );
}
