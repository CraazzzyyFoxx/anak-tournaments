"use client";

import type { ReactNode } from "react";
import { AlertTriangle, SlidersHorizontal, Trash2, X } from "lucide-react";

import {
  ICON_BUTTON_CLASS,
  PANEL_CLASS,
  splitBattleTag,
} from "@/app/balancer/components/balancer-page-helpers";
import {
  CAPTION_CLASS,
  CARD_TITLE_CLASS,
  EYEBROW_CLASS,
  ROLE_TILE_CLASS,
} from "@/app/balancer/pickup/pickup-chrome";
import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Switch } from "@/components/ui/switch";
import { useDivisionGrid } from "@/hooks/useCurrentWorkspace";
import { resolveDivisionFromRank } from "@/lib/division-grid";
import { ROLE_LABELS, ROLES } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { CustomGamePlayer, CustomGamePlayerPatch } from "@/services/custom-game.service";

import {
  LINEUP_ROLES,
  averageRank,
  getLineupIssue,
  playerLabel,
  resolveRoleOrder,
  sortLineup,
  summarizeLineup,
  summarizeRoleSupply,
  toggleRole,
} from "./pickup-lineup";

/**
 * Marks a subtree as owning its own clicks, so the clickable row skips it.
 *
 * A plain wrapper with no handler: putting `onClick` on a `<span>` to swallow
 * the bubble made the row's own logic depend on a non-interactive element
 * having a listener, which the design gate rightly rejects. The row filters by
 * this attribute instead — the same `data-card-action` convention the
 * tournament pool row uses.
 */
function RowAction({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span data-card-action className="flex shrink-0 items-center">
      {children}
    </span>
  );
}

type PickupLobbyPanelProps = {
  canWrite: boolean;
  hasMix: boolean;
  rows: CustomGamePlayer[];
  savingPlayerId: number | null;
  clearing: boolean;
  onPatchPlayer: (workspacePlayerId: number, patch: CustomGamePlayerPatch) => void;
  onClear: () => void;
  onRemovePlayer: (workspacePlayerId: number) => void;
  onOpenPlayer: (workspacePlayerId: number) => void;
  onOpenPool: () => void;
};

/**
 * The lineup: who is in this mix, who the next balance will use, and whether the
 * roles they picked can actually fill two teams.
 *
 * Membership belongs to the player pool — adding or removing someone there
 * writes here. This column owns *participation*: the switch benches a player
 * server-side without touching their rank override or role order, so "he's
 * late, start without him" costs one click and no rework.
 *
 * The role-supply strip sits above the rows on purpose. A host reads "short 1
 * tank" before pressing Balance, instead of reading a seated lineup afterwards
 * and guessing which player the solver had to move off their first choice.
 */
export function PickupLobbyPanel({
  canWrite,
  hasMix,
  rows,
  savingPlayerId,
  clearing,
  onPatchPlayer,
  onClear,
  onRemovePlayer,
  onOpenPlayer,
  onOpenPool,
}: Readonly<PickupLobbyPanelProps>) {
  const lineup = sortLineup(rows);
  const active = lineup.filter((row) => row.is_active);
  const benched = lineup.filter((row) => !row.is_active);
  const summary = summarizeLineup(rows);
  const supply = summarizeRoleSupply(rows);

  return (
    <div className={cn(PANEL_CLASS, "flex min-h-0 min-w-0 flex-col")}>
      <div className="flex items-center gap-2.5 border-b border-[color:var(--aqt-border)] px-4 py-3.5">
        <h2 className={CARD_TITLE_CLASS}>Lineup</h2>
        <span className={CAPTION_CLASS}>
          {`${summary.active} in the balance`}
          {summary.benched > 0 ? ` \u00B7 ${summary.benched} benched` : ""}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {canWrite ? (
            <button
              type="button"
              onClick={onOpenPool}
              className={cn(
                EYEBROW_CLASS,
                "rounded px-1 tracking-[0.14em] text-[color:var(--aqt-teal)] transition-colors hover:text-[color:color-mix(in_srgb,var(--aqt-teal)_80%,white)]",
              )}
            >
              Add players &rarr;
            </button>
          ) : null}
          {canWrite && rows.length > 0 ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                {/* Icon-only: the confirm dialog already spells the action out in
                    full, and a text button here competed with Add players. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(ICON_BUTTON_CLASS, "size-7 shrink-0 hover:text-rose-200")}
                  title="Empty the lobby"
                  disabled={clearing}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Empty the lobby</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Empty the lobby?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {`This removes all ${rows.length} players from this mix, along with their per-mix rank overrides and role order. Workspace ranks are not affected.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep the lobby</AlertDialogCancel>
                  <AlertDialogAction onClick={onClear}>Remove everyone</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="flex border-b border-[color:var(--aqt-border)]">
          {supply.map((entry) => {
            const icon = ROLES.find((role) => role.code === entry.role)?.icon ?? "Support";
            return (
              <div
                key={entry.role}
                className="flex-1 border-r border-[color:var(--aqt-border)] px-3.5 py-2.5 last:border-r-0"
              >
                <div className="flex items-center gap-1.5">
                  <PlayerRoleIcon role={icon} size={16} decorative />
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--aqt-fg-dim)]">
                    {ROLE_LABELS[entry.role]}
                  </span>
                  <span
                    className={cn(
                      "ml-auto font-mono text-[13px] font-semibold tabular-nums",
                      entry.short > 0
                        ? "text-[color:var(--aqt-amber)]"
                        : "text-[color:var(--aqt-emerald)]",
                    )}
                  >
                    {entry.short > 0
                      ? `${entry.supply} of ${entry.need} \u00B7 short ${entry.short}`
                      : `${entry.supply} of ${entry.need}`}
                  </span>
                </div>
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      entry.short > 0
                        ? "bg-[color:var(--aqt-amber)]"
                        : "bg-[color:var(--aqt-emerald)]",
                    )}
                    style={{ width: `${Math.min(100, Math.round((entry.supply / entry.need) * 100))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {summary.blocking > 0 ? (
        <p className="flex items-start gap-2 border-b border-[color:var(--aqt-border)] bg-[color:color-mix(in_srgb,var(--aqt-amber)_6%,transparent)] px-4 py-2.5 text-[13px] text-[color:var(--aqt-amber)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {summary.blocking === 1
              ? "1 player has no ranked role and will fail the balance."
              : `${summary.blocking} players have no ranked role and will fail the balance.`}
          </span>
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {!hasMix ? (
          <PageStateCard
            state="empty"
            title="No mix selected"
            description="Pick or create a mix to start filling the lineup."
            className="px-4 py-8"
          />
        ) : lineup.length === 0 ? (
          <PageStateCard
            state="empty"
            title="Lineup is empty"
            description={
              canWrite
                ? "Add players from the workspace pool to put them in this mix."
                : "No players have been added to this mix."
            }
            className="px-4 py-8"
          />
        ) : (
          <>
            <ul className="px-2.5 py-2" aria-label="Mix lineup">
              {active.map((row) => (
                <LineupRow
                  key={row.workspace_player_id}
                  row={row}
                  canWrite={canWrite}
                  saving={savingPlayerId === row.workspace_player_id}
                  onPatch={(patch) => onPatchPlayer(row.workspace_player_id, patch)}
                  onOpen={() => onOpenPlayer(row.workspace_player_id)}
                  onRemove={() => onRemovePlayer(row.workspace_player_id)}
                />
              ))}
            </ul>

            {benched.length > 0 ? (
              <div className="border-t border-[color:var(--aqt-border)] px-4 pb-2 pt-2.5">
                <div className={cn(EYEBROW_CLASS, "tracking-[0.14em]")}>
                  {`Benched \u00B7 ${benched.length}`}
                </div>
                <ul className="mt-1">
                  {benched.map((row) => (
                    <BenchedRow
                      key={row.workspace_player_id}
                      row={row}
                      canWrite={canWrite}
                      saving={savingPlayerId === row.workspace_player_id}
                      onPatch={(patch) => onPatchPlayer(row.workspace_player_id, patch)}
                      onOpen={() => onOpenPlayer(row.workspace_player_id)}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Role chips carry two facts in one 30px tile: whether the balancer may use the
 * role at all (lit vs dimmed) and, when it may, at what priority (the corner
 * number). The amber ring is the third: selected, but with no rank behind it,
 * which is the case that fails the whole run server-side.
 *
 * Positions are the canonical tank/dps/support order, NOT the host's priority
 * order. Priority is what the corner number is for; letting it move the tiles
 * as well made the column reshuffle per row, so "who can tank" stopped being
 * answerable by reading straight down one position.
 */
function RoleChips({
  row,
  label,
  canWrite,
  saving,
  onPatch,
}: Readonly<{
  row: CustomGamePlayer;
  label: string;
  canWrite: boolean;
  saving: boolean;
  onPatch: (patch: CustomGamePlayerPatch) => void;
}>) {
  const order = resolveRoleOrder(row);

  return (
    <div
      role="group"
      aria-label={`Roles for ${label}`}
      className="flex w-[102px] shrink-0 items-center justify-end gap-1.5"
    >
      {LINEUP_ROLES.map((role) => {
        const position = order.indexOf(role);
        const isOn = position !== -1;
        const roleRank = row.ranks[role];
        const icon = ROLES.find((item) => item.code === role)?.icon ?? "Support";
        return (
          <button
            key={role}
            type="button"
            disabled={!canWrite || saving}
            aria-pressed={isOn}
            aria-label={
              isOn
                ? `${ROLE_LABELS[role]} for ${label}, priority ${position + 1}${roleRank == null ? ", no rank" : `, ${roleRank} points`}`
                : `${ROLE_LABELS[role]} for ${label}, off`
            }
            title={roleRank == null ? `${ROLE_LABELS[role]}: no rank` : `${ROLE_LABELS[role]}: ${roleRank} pts`}
            onClick={() => onPatch({ roles: toggleRole(order, role) })}
            className={cn(
              "relative flex size-[30px] shrink-0 items-center justify-center rounded-lg transition-opacity",
              ROLE_TILE_CLASS[role],
              isOn ? "opacity-100" : "opacity-30",
              isOn && roleRank == null && "ring-1 ring-amber-400/70",
              "disabled:cursor-default",
            )}
          >
            <PlayerRoleIcon role={icon} size={19} decorative />
            {isOn ? (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-card-2)] px-0.5 font-mono text-[11px] font-bold leading-none tabular-nums text-[color:var(--aqt-fg-muted)]"
              >
                {position + 1}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

type LineupRowProps = {
  row: CustomGamePlayer;
  canWrite: boolean;
  saving: boolean;
  onPatch: (patch: CustomGamePlayerPatch) => void;
  onOpen: () => void;
  onRemove: () => void;
};

function LineupRow({ row, canWrite, saving, onPatch, onOpen, onRemove }: Readonly<LineupRowProps>) {
  // The workspace grid, not the default one: `DivisionIcon` resolves its image
  // from the workspace grid, so a division number derived from any other grid
  // renders a crest that disagrees with the number beside it.
  const grid = useDivisionGrid();
  const label = playerLabel(row);
  const { name, suffix } = splitBattleTag(label);
  const issue = getLineupIssue(row);
  const rank = averageRank(row);
  const division = resolveDivisionFromRank(grid, rank);

  return (
    <li
      // The whole card opens the drawer: at this density every row IS a
      // settings row, and making the host aim at a 24px gear was the most-missed
      // target on the screen. A click that started inside a `RowAction` belongs
      // to that control, so a switch or a chip is still just itself.
      //
      // Deliberately NOT `role="button"` + `tabIndex`: that would put a second
      // focus stop in front of every row's real controls and announce the row
      // as a button that also contains buttons. The gear below is the keyboard
      // and screen-reader affordance; this handler is a pointer shortcut to the
      // same action, which is why the row stays a plain list item.
      title={`${label} \u2014 roles, priority and mix rank`}
      onClick={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("[data-card-action]")) {
          return;
        }
        onOpen();
      }}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 transition-colors",
        "hover:border-[color:var(--aqt-border-2)] hover:bg-white/[0.025]",
        issue && "border-amber-400/35",
      )}
    >
      <RowAction>
        <Switch
          checked={row.is_active}
          disabled={!canWrite || saving}
          aria-label={`Include ${label} in the balance`}
          onCheckedChange={(checked) => onPatch({ is_active: checked === true })}
          className="h-5 w-[34px] shrink-0 [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-[15px]"
        />
      </RowAction>

      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-[13.5px] font-semibold text-[color:var(--aqt-fg)]">{name}</span>
        {suffix ? (
          <span className="shrink-0 font-mono text-xs text-[color:var(--aqt-fg-faint)]">{suffix}</span>
        ) : null}
      </span>

      <RowAction>
        <RoleChips row={row} label={label} canWrite={canWrite} saving={saving} onPatch={onPatch} />
      </RowAction>

      <div className="flex w-[92px] shrink-0 items-center justify-end gap-1.5">
        {division == null ? null : (
          <DivisionIcon division={division} tournamentGrid={grid} width={22} height={22} />
        )}
        <span
          title={row.rank_value == null ? "Workspace ranks" : "Mix rank override"}
          className="font-mono text-[13.5px] font-semibold tabular-nums text-[color:var(--aqt-fg)]"
        >
          {rank ?? "\u2014"}
          {row.rank_value == null ? null : (
            <>
              <span aria-hidden="true" className="text-[color:var(--aqt-teal)]">
                *
              </span>
              <span className="sr-only"> (mix rank override)</span>
            </>
          )}
        </span>
      </div>

      <button
        type="button"
        onClick={onOpen}
        title="Advanced settings"
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-[color:var(--aqt-fg-faint)] transition-colors hover:bg-white/[0.05] hover:text-[color:var(--aqt-fg-muted)]"
      >
        <SlidersHorizontal className="size-[15px]" aria-hidden="true" />
        <span className="sr-only">{`Advanced settings for ${label}`}</span>
      </button>

      {canWrite ? (
        <RowAction>
          <button
            type="button"
            onClick={onRemove}
            title="Remove from this mix"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-[color:var(--aqt-fg-faint)] transition-colors hover:bg-white/[0.05] hover:text-[color:var(--aqt-rose)]"
          >
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{`Remove ${label} from this mix`}</span>
          </button>
        </RowAction>
      ) : null}
    </li>
  );
}

/**
 * A benched row keeps its switch and its settings but drops the priority
 * numbers and the points column: nothing about it feeds the next balance, so
 * the only questions left are "who is sitting out" and "why".
 */
function BenchedRow({
  row,
  canWrite,
  saving,
  onPatch,
  onOpen,
}: Readonly<{
  row: CustomGamePlayer;
  canWrite: boolean;
  saving: boolean;
  onPatch: (patch: CustomGamePlayerPatch) => void;
  onOpen: () => void;
}>) {
  const label = playerLabel(row);
  const { name, suffix } = splitBattleTag(label);
  const order = resolveRoleOrder(row);

  return (
    <li className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 opacity-65 transition-opacity hover:bg-white/[0.025] hover:opacity-90">
      <Switch
        checked={row.is_active}
        disabled={!canWrite || saving}
        aria-label={`Include ${label} in the balance`}
        onCheckedChange={(checked) => onPatch({ is_active: checked === true })}
        className="h-5 w-[34px] shrink-0 [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-[15px]"
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded text-left"
      >
        <span className="truncate text-[13.5px] font-medium text-[color:var(--aqt-fg)]">{name}</span>
        {suffix ? (
          <span className="shrink-0 font-mono text-xs text-[color:var(--aqt-fg-faint)]">{suffix}</span>
        ) : null}
      </button>
      <div aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
        {LINEUP_ROLES.map((role) => {
          const icon = ROLES.find((item) => item.code === role)?.icon ?? "Support";
          return (
            <span key={role} className={cn(order.includes(role) ? "opacity-100" : "opacity-25")}>
              <PlayerRoleIcon role={icon} size={15} decorative />
            </span>
          );
        })}
      </div>
      <span className="w-[104px] shrink-0 text-right font-mono text-xs text-[color:var(--aqt-fg-faint)]">
        {order.length === 0 ? "no ranked role" : "benched"}
      </span>
    </li>
  );
}
