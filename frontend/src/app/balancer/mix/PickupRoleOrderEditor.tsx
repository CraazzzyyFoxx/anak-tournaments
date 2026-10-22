"use client";

import {
  AccentBadge,
  RoleRankControls,
  accentRowStyle,
  accentTextStyle,
  roleRankAccent,
  type RoleRankAccent
} from "@/app/balancer/components/RoleRankControls";
import { rectSortingStrategy } from "@dnd-kit/sortable";

import { SortableGrip, SortableRows, useSortableRow } from "@/components/kit/SortableRows";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Switch } from "@/components/ui/switch";
import DivisionIcon from "@/components/DivisionIcon";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useSlotLabel } from "@/hooks/useSlotLabel";
import { getDivisionLabel, resolveDivisionFromRank } from "@/lib/divisions/grid";
import { cn } from "@/lib/utils";

import type { MixOwner } from "./pickup-lineup";

/**
 * One role's rank, as this editor should render it.
 *
 * `onChange === null` is the read-only case. A mix's ranks are the HOST's book
 * (`author_user_id = game.host_user_id`), so the host's sheet edits them from
 * here and a player's own panel only reads them -- the player owns `roles` and
 * `is_flex` and nothing else on their row.
 */
type PickupRoleRank = {
  rankValue: number | null;
  /** Which layer the shown rank came from, badged beside it. */
  sourceLabel: string | null;
  onChange: ((next: number | null) => void) | null;
  /** Only offered when there is an own entry to drop. */
  onClear: (() => void) | null;
};

type PickupRoleOrderEditorProps = {
  /** The mix owner's game: the roles on offer, their names/tints and the grid the ranks are on. */
  owner: MixOwner;
  /** The roles that are ON, in priority order -- position is what the balancer reads. */
  order: readonly string[];
  isFlex: boolean;
  disabled: boolean;
  /** Whose roles these are; every control's accessible name ends in it. */
  label: string;
  onReorder: (next: string[]) => void;
  onToggle: (role: string) => void;
  onFlexChange: (next: boolean) => void;
  rankFor: (role: string) => PickupRoleRank;
  /** `grid`: 2x2 once the container fits two cards (the player's seat panel).
   * `list`: one column at any width (the host's sheet, where the rank fields need the room). */
  layout?: "grid" | "list";
};

/**
 * Role priority and the flex flag, in one place for both callers.
 *
 * Priority is a drag list because the stored role order *is* the balancer's
 * priority (see `CustomGamePlayer.roles`): deriving it from a rank moved a
 * role's seat the moment any layer's number changed, with no click anyone
 * could point at. Dragging makes it what it always was on the wire.
 *
 * Off roles trail the on ones in the game's declared order: an unselected role has no
 * priority, so ranking them would imply one.
 *
 * A one-role game (`owner.showsRoles` false) has nothing to order or switch: only its rank is shown. A game without
 * Full flex (`owner.flex` false) gets no flex switch.
 */
export function PickupRoleOrderEditor({
  owner,
  order,
  isFlex,
  disabled,
  label,
  onReorder,
  onToggle,
  onFlexChange,
  rankFor,
  layout = "list"
}: Readonly<PickupRoleOrderEditorProps>) {
  if (!owner.showsRoles) {
    const [role] = owner.roles;
    return role == null ? null : <OnlyRoleRank role={role} owner={owner} disabled={disabled} rank={rankFor(role)} />;
  }
  const offRoles = owner.roles.filter((role) => !order.includes(role));

  return (
    // `contents` on the lists lets their cards sit in this grid directly.
    <div className="@container">
      <div className={cn("grid gap-2", layout === "grid" && "@xl:grid-cols-2")}>
        {owner.flex ? (
          <div
            className={cn(
              "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
              isFlex
                ? "border-emerald-400/20 bg-emerald-500/[0.08]"
                : "border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)]"
            )}
          >
            <div className="min-w-0">
              <span className="text-xs font-medium text-[color:var(--aqt-fg)]">Full flex</span>
              {isFlex ? (
                <p className="mt-0.5 text-label text-[color:var(--aqt-fg-dim)]">
                  Every role is equally preferred — priority order stops mattering.
                </p>
              ) : (
                <p className="mt-0.5 text-label text-[color:var(--aqt-fg-dim)]">
                  Drag below to set who the balancer seats first.
                </p>
              )}
            </div>
            <Switch
              checked={isFlex}
              disabled={disabled}
              aria-label={`Full flex for ${label}`}
              onCheckedChange={onFlexChange}
            />
          </div>
        ) : null}

        <SortableRows
          items={order}
          getId={(role) => role}
          onReorder={onReorder}
          strategy={layout === "grid" ? rectSortingStrategy : undefined}
          className="contents"
        >
          {(role, index) => (
            <SortableRoleCard
              key={role}
              id={role}
              role={role}
              owner={owner}
              label={label}
              priority={index + 1}
              isPrimary={index === 0}
              disabled={disabled}
              onToggle={() => onToggle(role)}
              rank={rankFor(role)}
            />
          )}
        </SortableRows>

        {offRoles.length === 0 ? null : (
          <ul className="contents">
            {offRoles.map((role) => (
              <li
                key={role}
                className="flex items-start gap-2.5 rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-overlay-1)] p-2.5 opacity-80"
              >
                <RoleCardBody
                  role={role}
                  owner={owner}
                  label={label}
                  isOn={false}
                  isPrimary={false}
                  disabled={disabled}
                  onToggle={() => onToggle(role)}
                  rank={rankFor(role)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One role's card, wired to the drag list: grip, then the row's own content. */
function SortableRoleCard({
  id,
  role,
  owner,
  label,
  priority,
  isPrimary,
  disabled,
  onToggle,
  rank
}: Readonly<{
  id: string;
  role: string;
  owner: MixOwner;
  label: string;
  /** The row's position in the drag list, 1-based — what the balancer reads as priority. */
  priority: number;
  isPrimary: boolean;
  disabled: boolean;
  onToggle: () => void;
  rank: PickupRoleRank;
}>) {
  const { ref, style, handleProps } = useSortableRow(id, disabled);
  const slotLabel = useSlotLabel(owner.ontology);

  return (
    <li
      ref={ref}
      style={{ ...style, ...accentRowStyle(roleRankAccent(owner.ontology, role)) }}
      className="flex items-start gap-2.5 rounded-xl border p-2.5 transition-colors"
    >
      <div className="flex items-center gap-1">
        <SortableGrip
          handleProps={handleProps}
          label={`Reorder ${slotLabel(role)} for ${label}`}
          disabled={disabled}
        />
        <span className="text-label font-semibold text-[color:var(--aqt-fg-dim)]">{`#${priority}`}</span>
      </div>
      <RoleCardBody
        role={role}
        owner={owner}
        label={label}
        isOn
        isPrimary={isPrimary}
        disabled={disabled}
        onToggle={onToggle}
        rank={rank}
      />
    </li>
  );
}

/**
 * One role's card: name, first-choice mark, on/off, and the rank.
 *
 * Where the rank is editable (`rank.onChange`), the field edits the *effective*
 * rank — what balance will actually use — rather than only this host's own
 * entry, because a host reads the number they see and expects to be able to
 * correct it. Where it is not, the same number is printed as a crest beside
 * the role name: a player must see why the balancer seats them where it does,
 * and a boxed number under it read as a field they were expected to fill in.
 */
function RoleCardBody({
  role,
  owner,
  label,
  isOn,
  isPrimary,
  disabled,
  onToggle,
  rank
}: Readonly<{
  role: string;
  owner: MixOwner;
  label: string;
  isOn: boolean;
  /** The top of the drag list — where the balancer will try to seat them first. */
  isPrimary: boolean;
  disabled: boolean;
  onToggle: () => void;
  rank: PickupRoleRank;
}>) {
  const slotLabel = useSlotLabel(owner.ontology);
  const accent = roleRankAccent(owner.ontology, role);
  const name = slotLabel(role);
  const offText = { color: "var(--aqt-fg-muted)" };

  const readOnly = rank.onChange == null;

  return (
    <div className={cn("min-w-0 flex-1", !readOnly && "space-y-2")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <PlayerRoleIcon role={role} ontology={owner.ontology} size={15} decorative />
          <span
            className="text-xs font-semibold"
            style={isOn ? accentTextStyle(accent) : offText}
          >
            {name}
          </span>
          {isPrimary ? (
            <AccentBadge accent={accent} className="shrink-0 font-bold uppercase tracking-label">
              First
            </AccentBadge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {readOnly ? <RankChip rank={rank} grid={owner.grid} active={isOn} accent={accent} /> : null}
          <label className="flex items-center gap-1.5">
            <Switch
              checked={isOn}
              disabled={disabled}
              aria-label={`${name} for ${label}`}
              onCheckedChange={onToggle}
              size="sm"
            />
            <span
              className="text-label font-semibold uppercase tracking-label"
              style={isOn ? accentTextStyle(accent) : { color: "var(--aqt-fg-dim)" }}
            >
              {isOn ? "Active" : "Off"}
            </span>
          </label>
        </div>
      </div>

      {rank.onChange == null ? null : (
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_130px]">
          <RoleRankControls
            rankValue={rank.rankValue}
            sourceLabel={rank.sourceLabel}
            accent={accent}
            active={isOn}
            disabled={disabled}
            onClear={rank.onClear}
            onChange={rank.onChange}
            // The owner game's global ladder: the scale the value is on, so the
            // crest and the slider name the same tiers.
            grid={owner.grid}
          />
        </div>
      )}
    </div>
  );
}

/** A one-role game's rank: the crest and number, or the host's field, with nothing to choose around it. */
function OnlyRoleRank({
  role,
  owner,
  disabled,
  rank
}: Readonly<{ role: string; owner: MixOwner; disabled: boolean; rank: PickupRoleRank }>) {
  const accent = roleRankAccent(owner.ontology, role);
  return rank.onChange == null ? (
    <RankChip rank={rank} grid={owner.grid} active accent={accent} />
  ) : (
    <RoleRankControls
      rankValue={rank.rankValue}
      sourceLabel={rank.sourceLabel}
      accent={accent}
      active
      disabled={disabled}
      onClear={rank.onClear}
      onChange={rank.onChange}
      grid={owner.grid}
    />
  );
}

/** A rank nobody here may change: the crest and the number, no field around them. */
function RankChip({
  rank,
  grid,
  active,
  accent
}: Readonly<{
  rank: PickupRoleRank;
  grid: MixOwner["grid"];
  active: boolean;
  accent: RoleRankAccent;
}>) {
  const division = resolveDivisionFromRank(grid, rank.rankValue);
  const divisionLabel = getDivisionLabel(grid, division);

  return (
    <span className="flex items-center gap-1.5">
      {division != null ? (
        <IconTooltip
          label={divisionLabel ?? String(division)}
          hint={rank.sourceLabel ?? "The rank the balancer uses for this role"}
        >
          <DivisionIcon
            division={division}
            tournamentGrid={grid}
            width={20}
            height={20}
            className={cn("size-5 object-contain", !active && "opacity-50")}
          />
        </IconTooltip>
      ) : null}
      <span
        className="text-xs font-semibold tabular-nums"
        style={active ? accentTextStyle(accent) : { color: "var(--aqt-fg-dim)" }}
      >
        {rank.rankValue ?? "—"}
      </span>
    </span>
  );
}
