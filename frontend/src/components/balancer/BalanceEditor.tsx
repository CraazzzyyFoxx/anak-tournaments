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
import { UserX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import PlayerDivisionIcon from "@/components/PlayerDivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
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
    return acc + team.roster[roleKey].reduce((sum, p) => sum + p.rating, 0);
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

const DIVISION_THRESHOLDS: Array<{ division: number; minRank: number }> = [
  { division: 1, minRank: 2000 },
  { division: 2, minRank: 1900 },
  { division: 3, minRank: 1800 },
  { division: 4, minRank: 1700 },
  { division: 5, minRank: 1600 },
  { division: 6, minRank: 1500 },
  { division: 7, minRank: 1400 },
  { division: 8, minRank: 1300 },
  { division: 9, minRank: 1200 },
  { division: 10, minRank: 1100 },
  { division: 11, minRank: 1000 },
  { division: 12, minRank: 900 },
  { division: 13, minRank: 800 },
  { division: 14, minRank: 700 },
  { division: 15, minRank: 600 },
  { division: 16, minRank: 500 },
  { division: 17, minRank: 400 },
  { division: 18, minRank: 300 },
  { division: 19, minRank: 200 },
  { division: 20, minRank: 0 },
];

function resolveDivisionFromRank(rankValue: number): number {
  for (const { division, minRank } of DIVISION_THRESHOLDS) {
    if (rankValue >= minRank) {
      return division;
    }
  }

  return 20;
}

// ─── Player row ───────────────────────────────────────────────────────────────

type PlayerRowProps = {
  player: InternalBalancePlayer;
  roleKey: BalancerRosterKey;
  dragging?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLTableRowElement>;
  rowRef?: React.Ref<HTMLTableRowElement>;
  style?: React.CSSProperties;
};

function PlayerRow({ player, roleKey, dragging = false, dragHandleProps, rowRef, style }: PlayerRowProps) {
  const division = resolveDivisionFromRank(player.rating);

  return (
    <TableRow
      ref={rowRef}
      style={style}
      className={cn(
        "border-white/[0.04] hover:bg-white/[0.03] cursor-grab active:cursor-grabbing select-none",
        dragging && "opacity-40",
      )}
      {...dragHandleProps}
    >
      <TableCell className="py-2.5 pl-5 pr-3 w-10">
        <PlayerRoleIcon role={roleKey} size={22} />
      </TableCell>
      <TableCell className="py-2.5 px-3 text-white/85 text-[15px] font-medium leading-none">{player.name}</TableCell>
      <TableCell className="py-2.5 px-2 text-center">
        <div className="flex justify-center" title={`Division ${division}`}>
          <PlayerDivisionIcon division={division} width={28} height={28} />
        </div>
      </TableCell>
      {/* Registered roles in priority order */}
      <TableCell className="py-2.5 pl-2 pr-5 text-center">
        <div className="flex items-center justify-center gap-0.5">
          {(player.preferences ?? []).map((pref, i) => (
            <span
              key={i}
              className={cn(
                "opacity-70",
                pref === roleKey && "opacity-100",
              )}
              title={`Priority ${i + 1}: ${pref}`}
            >
              <PlayerRoleIcon role={pref} size={16} />
            </span>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Draggable player ─────────────────────────────────────────────────────────

function DraggablePlayer({ player, roleKey }: { player: InternalBalancePlayer; roleKey: BalancerRosterKey }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: player.uuid });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <PlayerRow
      player={player}
      roleKey={roleKey}
      dragging={isDragging}
      rowRef={setNodeRef}
      style={style}
      dragHandleProps={{ ...listeners, ...attributes }}
    />
  );
}

// ─── Droppable role section ───────────────────────────────────────────────────

function DroppableRoleSection({
  containerId,
  roleKey,
  players,
}: {
  containerId: string;
  roleKey: BalancerRosterKey;
  players: InternalBalancePlayer[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: containerId });

  return (
    <TableBody
      ref={setNodeRef}
      className={cn("transition-colors", isOver && "[&_tr]:bg-white/[0.04]")}
    >
      {players.map((player) => (
        <DraggablePlayer key={player.uuid} player={player} roleKey={roleKey} />
      ))}

      {players.length === 0 && (
        <TableRow className="border-white/[0.04] hover:bg-transparent">
          <TableCell colSpan={4} className="py-3 px-5 text-center text-xs text-white/20">
            <span className="border border-dashed border-white/[0.1] rounded px-3 py-1">
              Drop {roleKey.toLowerCase()} here
            </span>
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

type BalanceEditorProps = {
  value: InternalBalancePayload | null;
  onChange: (payload: InternalBalancePayload) => void;
};

const TEAM_BORDER_COLORS = [
  "border-l-blue-500",
  "border-l-emerald-500",
  "border-l-amber-500",
  "border-l-rose-500",
  "border-l-violet-500",
  "border-l-cyan-500",
  "border-l-orange-500",
  "border-l-pink-500",
];

export const BalanceEditor = forwardRef<HTMLDivElement, BalanceEditorProps>(function BalanceEditor(
  { value, onChange },
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
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">Run the balancer to edit teams.</CardContent>
      </Card>
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
      ...player.preferences.filter((pref) => pref !== target.roleKey),
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

  const globalAvg =
    value.statistics?.averageMMR ??
    (teamCards.length > 0
      ? teamCards.reduce((s, t) => s + calculateTeamAverage(t), 0) / teamCards.length
      : 0);

  function getTeamDeviation(team: InternalBalancePayload["teams"][number]): number {
    if (!globalAvg) return 0;
    return Math.abs(calculateTeamAverage(team) - globalAvg);
  }

  const benchedPlayers = value.benchedPlayers ?? [];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => handleDragStart(String(event.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div ref={ref} className="space-y-4">
      {/* Benched players list */}
      {benchedPlayers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <span className="mr-1 text-xs font-medium text-red-400/80">Not assigned:</span>
          {benchedPlayers.map((p) => (
            <Badge
              key={p.uuid}
              variant="outline"
              className="gap-1 border-red-500/20 bg-red-500/10 text-red-300 text-xs py-0.5"
            >
              {p.preferences.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {p.preferences.map((pref, i) => (
                    <span key={i} className="opacity-70">
                      <PlayerRoleIcon role={pref} size={12} />
                    </span>
                  ))}
                </span>
              )}
              {p.name}
            </Badge>
          ))}
        </div>
      )}

      <div
        className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]"
      >
        {teamCards.map((team, teamIndex) => {
          const total = calculateTeamTotal(team);
          const avg = calculateTeamAverage(team);
          const borderColor = TEAM_BORDER_COLORS[teamIndex % TEAM_BORDER_COLORS.length];

          return (
            <div
              key={`${team.id}-${teamIndex}`}
              className={cn(
                "rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden border-l-4",
                borderColor,
              )}
            >
              {/* Header */}
              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <h3 className="text-base font-semibold text-white leading-snug truncate">{team.name}</h3>
                <div className="shrink-0 flex items-center gap-4 text-sm">
                  <span className="text-white/40 whitespace-nowrap">
                    Total: <span className="tabular-nums text-white/65">{total}</span>
                  </span>
                  <span className="text-white/40 whitespace-nowrap">
                    Avg: <span className="tabular-nums text-white/65">{avg.toFixed(0)}</span>
                  </span>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-white/[0.06]" />

              {/* Table */}
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/[0.06] hover:bg-transparent">
                      <TableHead className="h-9 pl-5 pr-3 text-[11px] uppercase tracking-wide text-white/30 font-semibold w-10">
                        Role
                      </TableHead>
                      <TableHead className="h-9 px-3 text-[11px] uppercase tracking-wide text-white/30 font-semibold">
                        Player
                      </TableHead>
                      <TableHead className="h-9 px-2 text-center text-[11px] uppercase tracking-wide text-white/30 font-semibold">
                        Div
                      </TableHead>
                      <TableHead className="h-9 pl-2 pr-5 text-center text-[11px] uppercase tracking-wide text-white/30 font-semibold">
                        Regs
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                {(Object.keys(team.roster) as BalancerRosterKey[]).map((roleKey) => (
                  <DroppableRoleSection
                    key={`${team.id}-${roleKey}`}
                    containerId={`${teamIndex}:${roleKey}`}
                    roleKey={roleKey}
                    players={team.roster[roleKey]}
                  />
                ))}
              </Table>
            </div>
          );
        })}
      </div>

      </div>{/* end ref wrapper */}

      {/* Drag overlay — floating row preview */}
      <DragOverlay>
        {activePlayer ? (
          <table className="w-80 rounded border border-white/[0.12] bg-zinc-900 shadow-xl text-sm">
            <tbody>
              <PlayerRow player={activePlayer.player} roleKey={activePlayer.roleKey} />
            </tbody>
          </table>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});
