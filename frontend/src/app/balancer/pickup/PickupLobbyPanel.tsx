"use client";

import { AlertTriangle, Trash2 } from "lucide-react";

import {
  ICON_BUTTON_CLASS,
  PANEL_CLASS,
  splitBattleTag,
} from "@/app/balancer/components/balancer-page-helpers";
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
import { Checkbox } from "@/components/ui/checkbox";
import { PageStateCard } from "@/components/ui/page-state-card";
import { ROLES, ROLE_ACCENTS, ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { CustomGamePlayer, CustomGamePlayerPatch } from "@/services/custom-game.service";

import {
  LINEUP_ISSUE_MESSAGES,
  LINEUP_ROLES,
  averageRank,
  getLineupIssue,
  playerLabel,
  resolveRoleOrder,
  sortLineup,
  summarizeLineup,
  toggleRole,
} from "./pickup-lineup";

type PickupLobbyPanelProps = {
  canWrite: boolean;
  hasMix: boolean;
  rows: CustomGamePlayer[];
  savingPlayerId: number | null;
  clearing: boolean;
  onPatchPlayer: (workspacePlayerId: number, patch: CustomGamePlayerPatch) => void;
  onClear: () => void;
  onOpenPlayer: (workspacePlayerId: number) => void;
};

/**
 * The lobby: who is in this mix, and which of them the next balance will use.
 *
 * Membership belongs to the player pool on the left — clicking a player there
 * adds or removes them here. This column owns *participation*: the checkbox
 * benches a player server-side without touching their rank override or role
 * order, so "he's late, start without him" costs one click and no rework.
 */
export function PickupLobbyPanel({
  canWrite,
  hasMix,
  rows,
  savingPlayerId,
  clearing,
  onPatchPlayer,
  onClear,
  onOpenPlayer,
}: Readonly<PickupLobbyPanelProps>) {
  const lobby = sortLineup(rows);
  const summary = summarizeLineup(rows);

  return (
    <div className={cn(PANEL_CLASS, "flex min-h-0 flex-col p-4")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]">Lobby</div>
          <div className="mt-1 text-sm tabular-nums text-[color:var(--aqt-fg-muted)]">
            {summary.active} in the balance
            {summary.benched > 0 ? ` \u00B7 ${summary.benched} out` : ""}
          </div>
        </div>
        {canWrite && rows.length > 0 ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              {/* Icon-only: at the column's narrow end a text label clipped, and
                  the confirm dialog already spells the action out in full. */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(ICON_BUTTON_CLASS, "shrink-0 hover:text-rose-200")}
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

      {summary.blocking > 0 ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {summary.blocking === 1
              ? "1 player has no ranked role and will fail the balance."
              : `${summary.blocking} players have no ranked role and will fail the balance.`}
          </span>
        </p>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
        {!hasMix ? (
          <PageStateCard
            state="empty"
            title="No mix selected"
            description="Pick or create a mix to start filling the lobby."
            className="px-4 py-8"
          />
        ) : lobby.length === 0 ? (
          <PageStateCard
            state="empty"
            title="Lobby is empty"
            description={
              canWrite
                ? "Click a player in the pool on the left to put them in this mix."
                : "No players have been added to this mix."
            }
            className="px-4 py-8"
          />
        ) : (
          <ul className="space-y-1.5" aria-label="Mix lobby">
            {lobby.map((row) => (
              <LobbyRow
                key={row.workspace_player_id}
                row={row}
                canWrite={canWrite}
                saving={savingPlayerId === row.workspace_player_id}
                onPatch={(patch) => onPatchPlayer(row.workspace_player_id, patch)}
                onOpen={() => onOpenPlayer(row.workspace_player_id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type LobbyRowProps = {
  row: CustomGamePlayer;
  canWrite: boolean;
  saving: boolean;
  onPatch: (patch: CustomGamePlayerPatch) => void;
  onOpen: () => void;
};

function LobbyRow({ row, canWrite, saving, onPatch, onOpen }: Readonly<LobbyRowProps>) {
  const label = playerLabel(row);
  const { name, suffix } = splitBattleTag(label);
  const order = resolveRoleOrder(row);
  const issue = getLineupIssue(row);
  const rank = averageRank(row);

  return (
    <li
      className={cn(
        "rounded-xl border px-2 py-1.5 transition-colors",
        "border-[color:var(--aqt-border)] bg-white/[0.02]",
        !row.is_active && "border-dashed opacity-55",
        issue && "border-amber-400/40",
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          checked={row.is_active}
          disabled={!canWrite || saving}
          aria-label={`Include ${label} in the balance`}
          onCheckedChange={(checked) => onPatch({ is_active: checked === true })}
          className="shrink-0"
        />
        <button
          type="button"
          title={`${label} \u2014 roles, priority and mix rank`}
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-baseline gap-1 rounded text-left"
        >
          <span className="truncate text-[13px] font-medium text-[color:var(--aqt-fg)]">{name}</span>
          {suffix ? (
            <span className="shrink-0 text-[11px] text-[color:var(--aqt-fg-dim)]">{suffix}</span>
          ) : null}
        </button>
        <div role="group" aria-label={`Roles for ${label}`} className="flex shrink-0 items-center gap-1">
          {[...order, ...LINEUP_ROLES.filter((role) => !order.includes(role))].map((role) => {
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
                  "relative flex size-7 items-center justify-center rounded-md transition-colors disabled:opacity-50",
                  isOn ? ROLE_ACCENTS[role].tile : "bg-white/[0.03] opacity-40",
                  isOn && roleRank == null && "ring-1 ring-amber-400/70",
                )}
              >
                <PlayerRoleIcon role={icon} size={14} decorative />
                {isOn ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-1 rounded-sm bg-[color:var(--aqt-bg)] px-0.5 text-[11px] font-semibold leading-none tabular-nums"
                  >
                    {position + 1}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-0.5 flex items-baseline gap-2 pl-6 text-[11px] text-[color:var(--aqt-fg-dim)]">
        <span className="tabular-nums">
          {rank ?? "\u2014"}
          {row.rank_value == null ? null : (
            <span title="Mix rank override">
              <span aria-hidden="true"> *</span>
              <span className="sr-only"> (mix rank override)</span>
            </span>
          )}
        </span>
        {row.team_index == null ? null : <span>{`Team ${row.team_index + 1}`}</span>}
        {issue ? <span className="text-amber-200">{LINEUP_ISSUE_MESSAGES[issue]}</span> : null}
      </div>
    </li>
  );
}
