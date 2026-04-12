"use client";

import { forwardRef, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, UserX } from "lucide-react";

import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveDivisionFromRankHelper } from "@/app/balancer/_components/workspace-helpers";
import type { DivisionGrid } from "@/types/workspace.types";
import {
  BalancerRosterKey,
  InternalBalancePayload,
  InternalBalancePlayer,
} from "@/types/balancer-admin.types";

const ROLE_CAPACITY: Record<BalancerRosterKey, number> = {
  Tank: 1,
  Damage: 2,
  Support: 2,
};

const ROLE_LABELS: Record<BalancerRosterKey, string> = {
  Tank: "Tank",
  Damage: "Damage",
  Support: "Support",
};

const ROLE_ACCENTS: Record<BalancerRosterKey, { text: string; chip: string; dot: string }> = {
  Tank: {
    text: "text-sky-300",
    chip: "border-sky-300/25 bg-sky-500/12 text-sky-200",
    dot: "bg-sky-300",
  },
  Damage: {
    text: "text-orange-300",
    chip: "border-orange-300/25 bg-orange-500/12 text-orange-200",
    dot: "bg-orange-300",
  },
  Support: {
    text: "text-emerald-300",
    chip: "border-emerald-300/25 bg-emerald-500/12 text-emerald-200",
    dot: "bg-emerald-300",
  },
};

const TEAM_ACCENTS = [
  "border-blue-400/20 bg-blue-500/10 text-blue-200",
  "border-rose-400/20 bg-rose-500/10 text-rose-200",
  "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
  "border-amber-400/20 bg-amber-500/10 text-amber-200",
  "border-violet-400/20 bg-violet-500/10 text-violet-200",
  "border-cyan-400/20 bg-cyan-500/10 text-cyan-200",
  "border-lime-400/20 bg-lime-500/10 text-lime-200",
  "border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-200",
  "border-pink-400/20 bg-pink-500/10 text-pink-200",
  "border-indigo-400/20 bg-indigo-500/10 text-indigo-200",
];

type PlayerLocation = {
  teamIndex: number;
  roleKey: BalancerRosterKey;
  playerIndex: number;
};

function clonePayload(payload: InternalBalancePayload): InternalBalancePayload {
  return JSON.parse(JSON.stringify(payload)) as InternalBalancePayload;
}

function findPlayerLocation(payload: InternalBalancePayload, playerId: string): PlayerLocation | null {
  for (const [teamIndex, team] of payload.teams.entries()) {
    for (const roleKey of Object.keys(team.roster) as BalancerRosterKey[]) {
      const playerIndex = team.roster[roleKey].findIndex((player) => player.uuid === playerId);
      if (playerIndex >= 0) {
        return { teamIndex, roleKey, playerIndex };
      }
    }
  }
  return null;
}

function parseContainerId(containerId: string): { teamIndex: number; roleKey: BalancerRosterKey } | null {
  const [teamIndexRaw, roleKeyRaw] = containerId.split(":");
  if (!teamIndexRaw || !roleKeyRaw) return null;
  if (!["Tank", "Damage", "Support"].includes(roleKeyRaw)) return null;
  return {
    teamIndex: Number(teamIndexRaw),
    roleKey: roleKeyRaw as BalancerRosterKey,
  };
}

function calculateTeamTotal(team: InternalBalancePayload["teams"][number]): number {
  return (Object.keys(team.roster) as BalancerRosterKey[]).reduce((acc, roleKey) => {
    return acc + team.roster[roleKey].reduce((sum, player) => sum + player.rating, 0);
  }, 0);
}

function calculateTeamAverage(team: InternalBalancePayload["teams"][number]): number {
  const totalPlayers = (Object.keys(team.roster) as BalancerRosterKey[]).reduce(
    (acc, roleKey) => acc + team.roster[roleKey].length,
    0,
  );
  if (!totalPlayers) return 0;
  return calculateTeamTotal(team) / totalPlayers;
}

function parsePlayerId(player: InternalBalancePlayer): number | null {
  const parsed = Number(player.uuid);
  return Number.isFinite(parsed) ? parsed : null;
}

type PlayerRowProps = {
  player: InternalBalancePlayer;
  roleKey: BalancerRosterKey;
  divisionGrid: DivisionGrid;
  selectedPlayerId?: number | null;
  dragging?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  rowRef?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  onSelectPlayer?: (playerId: number | null) => void;
};

function PlayerRow({
  player,
  roleKey,
  divisionGrid,
  selectedPlayerId,
  dragging = false,
  dragHandleProps,
  rowRef,
  style,
  onSelectPlayer,
}: PlayerRowProps) {
  const playerId = parsePlayerId(player);
  const division = resolveDivisionFromRankHelper(player.rating, divisionGrid);
  const isSelected = playerId !== null && selectedPlayerId === playerId;
  const accent = ROLE_ACCENTS[roleKey];
  const preferredRoles = player.preferences.slice(0, 3);
  const assignedOffRole = preferredRoles.length > 0 && preferredRoles[0] !== roleKey;

  return (
    <div
      ref={rowRef}
      style={style}
      className={cn(
        "grid cursor-grab select-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2.5 transition-all active:cursor-grabbing",
        dragging && "opacity-40",
        isSelected
          ? "border-violet-400/40 bg-violet-500/[0.08] shadow-[0_0_0_1px_rgba(139,92,246,0.14)]"
          : "border-white/6 bg-white/[0.02] hover:border-white/12 hover:bg-white/[0.04]",
      )}
      onClick={() => {
        if (playerId !== null) {
          onSelectPlayer?.(playerId);
        }
      }}
      {...dragHandleProps}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 opacity-95">
          <PlayerRoleIcon role={roleKey} size={18} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white/88">{player.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/34">
            <span className={cn("font-medium", accent.text)}>{ROLE_LABELS[roleKey]}</span>
            {assignedOffRole ? <span>Off-role</span> : null}
            {preferredRoles.length > 0 ? (
              <div className="flex items-center gap-1">
                {preferredRoles.map((preference, index) => (
                  <span key={`${player.uuid}-${preference}-${index}`} className="opacity-75">
                    <PlayerRoleIcon role={preference} size={12} />
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tabular-nums text-cyan-300">{player.rating}</span>
        {division != null ? (
          <span title={`Division ${division}`}>
            <PlayerDivisionIcon division={division} width={22} height={22} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DraggablePlayerRow(props: PlayerRowProps & { player: InternalBalancePlayer }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: props.player.uuid });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <PlayerRow
      {...props}
      dragging={isDragging}
      rowRef={setNodeRef}
      style={style}
      dragHandleProps={{ ...listeners, ...attributes }}
    />
  );
}

function DroppableRoleSection({
  containerId,
  roleKey,
  players,
  divisionGrid,
  selectedPlayerId,
  onSelectPlayer,
}: {
  containerId: string;
  roleKey: BalancerRosterKey;
  players: InternalBalancePlayer[];
  divisionGrid: DivisionGrid;
  selectedPlayerId?: number | null;
  onSelectPlayer?: (playerId: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: containerId });

  return (
    <div ref={setNodeRef} className={cn("space-y-1.5 rounded-xl transition-colors", isOver && "bg-white/[0.025] p-1")}>
      {players.map((player) => (
        <DraggablePlayerRow
          key={player.uuid}
          player={player}
          roleKey={roleKey}
          divisionGrid={divisionGrid}
          selectedPlayerId={selectedPlayerId}
          onSelectPlayer={onSelectPlayer}
        />
      ))}

      {players.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-center text-[11px] uppercase tracking-[0.14em] text-white/24">
          Drop {roleKey.toLowerCase()} here
        </div>
      ) : null}
    </div>
  );
}

type BalanceEditorProps = {
  value: InternalBalancePayload | null;
  onChange: (payload: InternalBalancePayload) => void;
  divisionGrid: DivisionGrid;
  selectedPlayerId?: number | null;
  onSelectPlayer?: (playerId: number | null) => void;
  collapsedTeamIds?: number[];
  onToggleTeam?: (teamId: number) => void;
};

export const BalanceEditor = forwardRef<HTMLDivElement, BalanceEditorProps>(function BalanceEditor(
  {
    value,
    onChange,
    divisionGrid,
    selectedPlayerId = null,
    onSelectPlayer,
    collapsedTeamIds = [],
    onToggleTeam,
  },
  ref,
) {
  const [activePlayer, setActivePlayer] = useState<{
    player: InternalBalancePlayer;
    roleKey: BalancerRosterKey;
  } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const teamCards = useMemo(() => value?.teams ?? [], [value]);

  if (!value || teamCards.length === 0) {
    return (
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-6 text-sm text-white/45">
        Run the balancer to edit teams.
      </div>
    );
  }

  const handleDragStart = (playerId: string) => {
    const location = findPlayerLocation(value, playerId);
    if (!location) {
      setActivePlayer(null);
      return;
    }

    setActivePlayer({
      player: value.teams[location.teamIndex].roster[location.roleKey][location.playerIndex],
      roleKey: location.roleKey,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActivePlayer(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;

    const from = findPlayerLocation(value, activeId);
    const target = parseContainerId(overId);
    if (!from || !target) return;

    const next = clonePayload(value);
    const sourcePlayers = next.teams[from.teamIndex].roster[from.roleKey];
    const [player] = sourcePlayers.splice(from.playerIndex, 1);
    const targetPlayers = next.teams[target.teamIndex].roster[target.roleKey];

    if (from.teamIndex === target.teamIndex && from.roleKey === target.roleKey) {
      sourcePlayers.splice(from.playerIndex, 0, player);
      return;
    }

    if (targetPlayers.length >= ROLE_CAPACITY[target.roleKey]) {
      sourcePlayers.splice(from.playerIndex, 0, player);
      return;
    }

    player.preferences = [
      target.roleKey,
      ...player.preferences.filter((preference) => preference !== target.roleKey),
    ];
    targetPlayers.push(player);

    next.teams = next.teams.map((team) => ({
      ...team,
      avgMMR: calculateTeamAverage(team),
    }));
    if (next.statistics) {
      next.statistics.averageMMR =
        next.teams.reduce((total, team) => total + calculateTeamAverage(team), 0) / next.teams.length;
    }

    onChange(next);
  };

  const benchedPlayers = value.benchedPlayers ?? [];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => handleDragStart(String(event.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div ref={ref} className="space-y-4">
        {benchedPlayers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/[0.05] px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-rose-200/80">
              <UserX className="h-3.5 w-3.5" />
              Unassigned
            </span>
            {benchedPlayers.map((player) => (
              <Badge
                key={player.uuid}
                className="rounded-full border-rose-300/20 bg-rose-500/12 text-rose-100 hover:bg-rose-500/12"
              >
                {player.name}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2">
          {teamCards.map((team, teamIndex) => {
            const avg = Math.round(calculateTeamAverage(team));
            const teamAccent = TEAM_ACCENTS[teamIndex % TEAM_ACCENTS.length];
            const collapsed = collapsedTeamIds.includes(team.id);
            const rosterDots = (Object.keys(team.roster) as BalancerRosterKey[]).flatMap((roleKey) =>
              team.roster[roleKey].map((player) => ({
                key: player.uuid,
                roleKey,
              })),
            );

            return (
              <div
                key={`${team.id}-${teamIndex}`}
                className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02]"
              >
                <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn("inline-flex h-7 min-w-7 items-center justify-center rounded-lg border px-2 text-sm font-semibold", teamAccent)}>
                      {team.id}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white/88">{team.name}</div>
                      <div className="mt-1 flex items-center gap-1.5">
                        {rosterDots.map((dot, dotIndex) => (
                          <span
                            key={`${dot.key}-${dotIndex}`}
                            className={cn("h-2.5 w-2.5 rounded-full", ROLE_ACCENTS[dot.roleKey].dot, "opacity-75")}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-cyan-300">{avg}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg border border-white/8 bg-black/10 text-white/45 hover:bg-white/5 hover:text-white"
                      onClick={() => onToggleTeam?.(team.id)}
                    >
                      {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {!collapsed ? (
                  <div className="space-y-1.5 p-3">
                    {(Object.keys(team.roster) as BalancerRosterKey[]).map((roleKey) => (
                      <DroppableRoleSection
                        key={`${team.id}-${roleKey}`}
                        containerId={`${teamIndex}:${roleKey}`}
                        roleKey={roleKey}
                        players={team.roster[roleKey]}
                        divisionGrid={divisionGrid}
                        selectedPlayerId={selectedPlayerId}
                        onSelectPlayer={onSelectPlayer}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <DragOverlay>
        {activePlayer ? (
          <div className="w-80 rounded-2xl border border-white/10 bg-[#141326] p-2 shadow-2xl shadow-black/40">
            <PlayerRow
              player={activePlayer.player}
              roleKey={activePlayer.roleKey}
              divisionGrid={divisionGrid}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});
