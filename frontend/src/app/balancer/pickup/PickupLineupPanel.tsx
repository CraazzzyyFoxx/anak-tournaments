"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Settings2, Shuffle, X } from "lucide-react";

import { PANEL_CLASS, splitBattleTag } from "@/app/balancer/components/balancer-page-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageStateCard } from "@/components/ui/page-state-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ROLE_ACCENTS, ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { CustomGame, CustomGamePlayer, CustomGamePlayerPatch } from "@/services/custom-game.service";

import { PickupPlayerSheet } from "./PickupPlayerSheet";
import {
  LINEUP_ISSUE_MESSAGES,
  LINEUP_ROLES,
  PICKUP_STATUS_LABELS,
  averageRank,
  getLineupIssue,
  groupTeams,
  parseAssignedRoles,
  playerLabel,
  resolveRoleOrder,
  sortLineup,
  summarizeLineup,
  toggleRole,
} from "./pickup-lineup";

type PickupLineupPanelProps = {
  canEdit: boolean;
  games: CustomGame[];
  gamesLoading: boolean;
  gamesError: boolean;
  onRetryGames: () => void;
  game: CustomGame | undefined;
  gameLoading: boolean;
  selectedGameId: number | null;
  onSelectGame: (gameId: number) => void;
  creating: boolean;
  onCreateGame: (name: string) => void;
  balancing: boolean;
  onBalance: () => void;
  savingPlayerId: number | null;
  onPatchPlayer: (workspacePlayerId: number, patch: CustomGamePlayerPatch) => void;
  onRemovePlayer: (workspacePlayerId: number) => void;
};

/**
 * The mix side of the pickup screen: which mix, who is in it, and the teams the
 * last balance produced.
 *
 * The lineup is deliberately two independent axes. Membership is the pool
 * sidebar's job (add / remove). Participation is the row switch, which benches
 * a player server-side without touching their rank override or role order — so
 * "he's late, start without him" costs one click and no rework.
 */
export function PickupLineupPanel({
  canEdit,
  games,
  gamesLoading,
  gamesError,
  onRetryGames,
  game,
  gameLoading,
  selectedGameId,
  onSelectGame,
  creating,
  onCreateGame,
  balancing,
  onBalance,
  savingPlayerId,
  onPatchPlayer,
  onRemovePlayer,
}: Readonly<PickupLineupPanelProps>) {
  const [newName, setNewName] = useState("");
  const [openPlayerId, setOpenPlayerId] = useState<number | null>(null);

  const rows = game?.players ?? [];
  const lineup = sortLineup(rows);
  const summary = summarizeLineup(rows);
  const teams = groupTeams(rows);
  const assignedRoles = parseAssignedRoles(game?.result_json);
  const isTerminal = game != null && (game.status === "completed" || game.status === "cancelled");
  const canWrite = canEdit && game != null && !isTerminal;
  const openRow = rows.find((row) => row.workspace_player_id === openPlayerId) ?? null;

  return (
    <div className={cn(PANEL_CLASS, "flex min-h-0 flex-col p-4")}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]">Mix</div>
          <div className="mt-1 flex items-center gap-2">
            <Select
              value={selectedGameId == null ? undefined : String(selectedGameId)}
              disabled={gamesLoading || games.length === 0}
              onValueChange={(value) => onSelectGame(Number(value))}
            >
              <SelectTrigger className="h-9 min-w-0 flex-1" aria-label="Select a mix">
                <SelectValue placeholder={games.length === 0 ? "No mixes yet" : "Pick a mix"} />
              </SelectTrigger>
              <SelectContent>
                {games.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {game ? (
              <Badge variant="outline" className="shrink-0">
                {PICKUP_STATUS_LABELS[game.status] ?? game.status}
              </Badge>
            ) : null}
          </div>
        </div>

        {canEdit ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newName.trim();
              if (!name) return;
              onCreateGame(name);
              setNewName("");
            }}
          >
            <div>
              <label
                htmlFor="pickup-new-mix"
                className="block text-[11px] uppercase tracking-[0.14em] text-[color:var(--aqt-fg-dim)]"
              >
                New mix
              </label>
              <Input
                id="pickup-new-mix"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Thursday scrim"
                autoComplete="off"
                className="mt-1 h-9 w-44"
              />
            </div>
            <Button type="submit" size="sm" className="h-9" disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden="true" /> : null}
              Create
            </Button>
          </form>
        ) : null}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {gamesError ? (
          <PageStateCard
            state="error"
            title="Unable to load mixes"
            description="Check your connection and try again."
            actionLabel="Retry"
            onAction={onRetryGames}
            className="px-4 py-10"
          />
        ) : gamesLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : games.length === 0 ? (
          <PageStateCard
            state="empty"
            title="No mixes yet"
            description={
              canEdit
                ? "Name a mix above to create it, then click players in the pool to build the lineup."
                : "A host has not created a mix in this workspace yet."
            }
            className="px-4 py-10"
          />
        ) : selectedGameId == null ? (
          <PageStateCard
            state="empty"
            title="Pick a mix"
            description="Choose a mix above to see and edit its lineup."
            className="px-4 py-10"
          />
        ) : gameLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-56 rounded-lg" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]">
                  Lineup
                </h2>
                <p className="text-sm tabular-nums text-[color:var(--aqt-fg-muted)]">
                  {summary.active} in the balance
                  {summary.benched > 0 ? ` \u00B7 ${summary.benched} benched` : ""}
                </p>
                <div className="flex-1" />
                {canWrite ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-9"
                    disabled={balancing || summary.active === 0}
                    onClick={onBalance}
                  >
                    {balancing ? (
                      <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Shuffle className="mr-1 size-3.5" aria-hidden="true" />
                    )}
                    Balance teams
                  </Button>
                ) : null}
              </div>

              {summary.blocking > 0 ? (
                <p className="flex items-start gap-1.5 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {summary.blocking === 1
                      ? "1 player has no ranked role and will fail the balance."
                      : `${summary.blocking} players have no ranked role and will fail the balance.`}
                  </span>
                </p>
              ) : null}

              {lineup.length === 0 ? (
                <PageStateCard
                  state="empty"
                  title="Lineup is empty"
                  description={
                    canWrite
                      ? "Click a player in the pool on the left to add them to this mix."
                      : "No players have been added to this mix."
                  }
                  className="px-4 py-8"
                />
              ) : (
                <ul className="space-y-1.5" aria-label="Mix lineup">
                  {lineup.map((row) => (
                    <LineupRow
                      key={row.workspace_player_id}
                      row={row}
                      canWrite={canWrite}
                      saving={savingPlayerId === row.workspace_player_id}
                      onPatch={(patch) => onPatchPlayer(row.workspace_player_id, patch)}
                      onRemove={() => onRemovePlayer(row.workspace_player_id)}
                      onOpen={() => setOpenPlayerId(row.workspace_player_id)}
                    />
                  ))}
                </ul>
              )}
            </section>

            {teams.length > 0 ? (
              <section className="space-y-2">
                <h2 className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]">
                  Teams
                </h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {teams.map((team) => (
                    <div
                      key={team.index}
                      className="rounded-xl border border-[color:var(--aqt-border)] bg-white/[0.02] p-3"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-sm font-medium">Team {team.index + 1}</h3>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {team.averageRank == null ? "\u2014" : `avg ${team.averageRank}`}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {team.players.map((row) => {
                          const role = assignedRoles[String(row.workspace_player_id)];
                          return (
                            <li
                              key={row.workspace_player_id}
                              className="flex items-baseline gap-2 text-[13px]"
                            >
                              <span
                                className={cn(
                                  "w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold uppercase tracking-wide",
                                  role ? ROLE_ACCENTS[role].tile : "bg-white/[0.04] text-muted-foreground",
                                )}
                              >
                                {role ? ROLE_LABELS[role] : "\u2014"}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{playerLabel(row)}</span>
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {averageRank(row) ?? "\u2014"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>

      <PickupPlayerSheet
        row={openRow}
        canEdit={canWrite}
        saving={openRow != null && savingPlayerId === openRow.workspace_player_id}
        onOpenChange={(open) => {
          if (!open) setOpenPlayerId(null);
        }}
        onPatch={(patch) => {
          if (openRow) onPatchPlayer(openRow.workspace_player_id, patch);
        }}
      />
    </div>
  );
}

type LineupRowProps = {
  row: CustomGamePlayer;
  canWrite: boolean;
  saving: boolean;
  onPatch: (patch: CustomGamePlayerPatch) => void;
  onRemove: () => void;
  onOpen: () => void;
};

function LineupRow({ row, canWrite, saving, onPatch, onRemove, onOpen }: Readonly<LineupRowProps>) {
  const label = playerLabel(row);
  const { name, suffix } = splitBattleTag(label);
  const order = resolveRoleOrder(row);
  const issue = getLineupIssue(row);
  const rank = averageRank(row);

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-2.5 py-1.5 transition-colors",
        "border-[color:var(--aqt-border)] bg-white/[0.02]",
        !row.is_active && "border-dashed opacity-60",
        issue && "border-amber-400/40",
      )}
    >
      <Switch
        checked={row.is_active}
        disabled={!canWrite || saving}
        aria-label={`Include ${label} in the balance`}
        onCheckedChange={(checked) => onPatch({ is_active: checked })}
      />
      <span title={label} className="flex min-w-32 flex-1 items-baseline gap-1">
        <span className="truncate text-[13px] font-medium text-[color:var(--aqt-fg)]">{name}</span>
        {suffix ? <span className="shrink-0 text-[12px] text-[color:var(--aqt-fg-dim)]">{suffix}</span> : null}
      </span>

      <div role="group" aria-label={`Roles for ${label}`} className="flex shrink-0 items-center gap-1">
        {[...order, ...LINEUP_ROLES.filter((role) => !order.includes(role))].map((role) => {
          const position = order.indexOf(role);
          const isOn = position !== -1;
          const roleRank = row.ranks[role];
          // Selected but unranked is the case that fails the whole balance, so
          // the offending chip says so instead of only the row-level warning.
          const unranked = isOn && roleRank == null;
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
              title={roleRank == null ? "No rank for this role" : `${roleRank} pts`}
              onClick={() => onPatch({ roles: toggleRole(order, role) })}
              className={cn(
                "flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-50",
                isOn ? ROLE_ACCENTS[role].tile : "bg-white/[0.03] text-[color:var(--aqt-fg-dim)]",
                unranked && "ring-1 ring-amber-400/70",
              )}
            >
              {isOn ? <span className="tabular-nums">{position + 1}</span> : null}
              {ROLE_LABELS[role]}
              {unranked ? <AlertTriangle className="size-3" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <span
        className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
        title={row.rank_value == null ? "Workspace ranks" : "Mix rank override"}
      >
        {rank ?? "\u2014"}
        {row.rank_value == null ? null : (
          <>
            <span aria-hidden="true" className="ml-1 text-[color:var(--aqt-fg-dim)]">
              *
            </span>
            <span className="sr-only"> (mix rank override)</span>
          </>
        )}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          title="Roles, priority and mix rank"
          onClick={onOpen}
        >
          <Settings2 className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{`Open mix settings for ${label}`}</span>
        </Button>
        {canWrite ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-[color:var(--aqt-fg-dim)] hover:text-rose-200"
            title="Remove from this mix"
            disabled={saving}
            onClick={onRemove}
          >
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{`Remove ${label} from this mix`}</span>
          </Button>
        ) : null}
      </div>

      {issue ? (
        <p className="basis-full text-[11px] text-amber-200">{LINEUP_ISSUE_MESSAGES[issue]}</p>
      ) : null}
    </li>
  );
}
