"use client";

import { useTranslations } from "next-intl";

import { RoleRankControls, roleRankAccent } from "@/app/balancer/components/RoleRankControls";
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
};

/** Hairlines between rows, nothing around them. */
const LIST_CLASS = "divide-y divide-[color:var(--aqt-border)]";

/** Every role row's columns: grip, position, then the role. An off role has no priority, so it leaves the first two empty. */
const ROW_CLASS = "grid grid-cols-[1.75rem_1.5rem_minmax(0,1fr)] items-center gap-x-1.5 gap-y-2 py-2";

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
  rankFor
}: Readonly<PickupRoleOrderEditorProps>) {
  const t = useTranslations("mixes.roleOrder");
  if (!owner.showsRoles) {
    const [role] = owner.roles;
    return role == null ? null : <OnlyRoleRank role={role} owner={owner} disabled={disabled} rank={rankFor(role)} />;
  }
  const offRoles = owner.roles.filter((role) => !order.includes(role));

  return (
    <div className={LIST_CLASS}>
      {owner.flex ? (
        <div className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="text-caption font-medium text-[color:var(--aqt-fg)]">{t("fullFlex")}</p>
            <p className="text-label text-[color:var(--aqt-fg-dim)]">{isFlex ? t("flexOn") : t("flexOff")}</p>
          </div>
          <Switch
            checked={isFlex}
            disabled={disabled}
            aria-label={t("flexFor", { name: label })}
            onCheckedChange={onFlexChange}
            size="sm"
          />
        </div>
      ) : null}

      {/* Mounted only with rows, since an empty block would still draw its hairline. Wrapped, because dnd-kit renders
          its screen-reader regions beside the list and the hairlines would count them as rows. */}
      {order.length === 0 ? null : (
        <div>
          <SortableRows items={order} getId={(role) => role} onReorder={onReorder} className={LIST_CLASS}>
            {(role, index) => (
              <SortableRoleRow
                key={role}
                id={role}
                role={role}
                owner={owner}
                label={label}
                priority={index + 1}
                disabled={disabled}
                onToggle={() => onToggle(role)}
                rank={rankFor(role)}
              />
            )}
          </SortableRows>
        </div>
      )}

      {offRoles.length === 0 ? null : (
        <ul className={LIST_CLASS}>
          {offRoles.map((role) => (
            <li key={role} className={ROW_CLASS}>
              <RoleRowBody
                role={role}
                owner={owner}
                label={label}
                isOn={false}
                disabled={disabled}
                onToggle={() => onToggle(role)}
                rank={rankFor(role)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One on role, wired to the drag list: grip, its position, then the row's own content. */
function SortableRoleRow({
  id,
  role,
  owner,
  label,
  priority,
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
  disabled: boolean;
  onToggle: () => void;
  rank: PickupRoleRank;
}>) {
  const t = useTranslations("mixes.roleOrder");
  const { ref, style, handleProps } = useSortableRow(id, disabled);
  const slotLabel = useSlotLabel(owner.ontology);

  return (
    <div ref={ref} style={style} className={ROW_CLASS}>
      <SortableGrip
        handleProps={handleProps}
        label={t("reorder", { role: slotLabel(role), name: label })}
        disabled={disabled}
      />
      <span className="aqt-tnum text-label font-semibold text-[color:var(--aqt-fg-dim)]">{`#${priority}`}</span>
      <RoleRowBody
        role={role}
        owner={owner}
        label={label}
        isOn
        disabled={disabled}
        onToggle={onToggle}
        rank={rank}
      />
    </div>
  );
}

/**
 * One role's row content: name, on/off, and the rank, in the row's third column.
 *
 * Where the rank is editable (`rank.onChange`), the field edits the *effective*
 * rank — what balance will actually use — rather than only this host's own
 * entry, because a host reads the number they see and expects to be able to
 * correct it. Where it is not, the same number is printed as a crest beside
 * the role name: a player must see why the balancer seats them where it does,
 * and a boxed number under it read as a field they were expected to fill in.
 */
function RoleRowBody({
  role,
  owner,
  label,
  isOn,
  disabled,
  onToggle,
  rank
}: Readonly<{
  role: string;
  owner: MixOwner;
  label: string;
  isOn: boolean;
  disabled: boolean;
  onToggle: () => void;
  rank: PickupRoleRank;
}>) {
  const t = useTranslations("mixes.roleOrder");
  const slotLabel = useSlotLabel(owner.ontology);
  const name = slotLabel(role);

  return (
    <>
      <div className="col-start-3 flex items-center justify-between gap-2">
        <span className={cn("flex min-w-0 items-center gap-1.5", !isOn && "opacity-60")}>
          <PlayerRoleIcon role={role} ontology={owner.ontology} size={15} decorative />
          <span className="truncate text-caption font-medium text-[color:var(--aqt-fg)]">{name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {rank.onChange == null ? <RankChip rank={rank} grid={owner.grid} active={isOn} /> : null}
          <Switch
            checked={isOn}
            disabled={disabled}
            aria-label={t("roleFor", { role: name, name: label })}
            onCheckedChange={onToggle}
            size="sm"
          />
        </span>
      </div>

      {rank.onChange == null ? null : (
        <div className="col-start-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_130px]">
          <RoleRankControls
            rankValue={rank.rankValue}
            sourceLabel={rank.sourceLabel}
            accent={roleRankAccent(owner.ontology, role)}
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
    </>
  );
}

/** A one-role game's rank: the crest and number, or the host's field, with nothing to choose around it. */
function OnlyRoleRank({
  role,
  owner,
  disabled,
  rank
}: Readonly<{ role: string; owner: MixOwner; disabled: boolean; rank: PickupRoleRank }>) {
  return rank.onChange == null ? (
    <RankChip rank={rank} grid={owner.grid} active />
  ) : (
    <RoleRankControls
      rankValue={rank.rankValue}
      sourceLabel={rank.sourceLabel}
      accent={roleRankAccent(owner.ontology, role)}
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
  active
}: Readonly<{
  rank: PickupRoleRank;
  grid: MixOwner["grid"];
  active: boolean;
}>) {
  const t = useTranslations("mixes.roleOrder");
  const division = resolveDivisionFromRank(grid, rank.rankValue);
  const divisionLabel = getDivisionLabel(grid, division);

  return (
    <span className="flex items-center gap-1.5">
      {division != null ? (
        <IconTooltip
          label={divisionLabel ?? String(division)}
          hint={rank.sourceLabel ?? t("rankHint")}
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
        className={cn(
          "aqt-tnum text-caption font-semibold",
          active ? "text-[color:var(--aqt-fg)]" : "text-[color:var(--aqt-fg-dim)]"
        )}
      >
        {rank.rankValue ?? "—"}
      </span>
    </span>
  );
}
