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

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
  if (!teamIndexRaw || !roleKeyRaw) {
    return null;
  }

  if (!["Tank", "Damage", "Support"].includes(roleKeyRaw)) {
    return null;
  }

  return {
    teamIndex: Number(teamIndexRaw),
    roleKey: roleKeyRaw as BalancerRosterKey,
  };
}

function calculateTeamTotal(team: InternalBalancePayload["teams"][number]): number {
  return (Object.keys(team.roster) as BalancerRosterKey[]).reduce((accumulator, roleKey) => {
    return accumulator + team.roster[roleKey].reduce((roleTotal, player) => roleTotal + player.rating, 0);
  }, 0);
}

function calculateTeamAverage(team: InternalBalancePayload["teams"][number]): number {
  const totalPlayers = (Object.keys(team.roster) as BalancerRosterKey[]).reduce(
    (accumulator, roleKey) => accumulator + team.roster[roleKey].length,
    0,
  );
  if (!totalPlayers) {
    return 0;
  }

  return calculateTeamTotal(team) / totalPlayers;
}

type PlayerCardProps = {
  player: InternalBalancePlayer;
  dragging?: boolean;
};

function PlayerCard({ player, dragging = false }: PlayerCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background px-3 py-2 text-sm shadow-sm transition-opacity",
        dragging && "opacity-60",
      )}
    >
      <div className="font-medium">{player.name}</div>
      <div className="text-xs text-muted-foreground">Rank: {player.rating}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {player.preferences.map((preference) => (
          <Badge key={preference} variant="secondary" className="text-[10px]">
            {preference}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function DraggablePlayer({ player }: { player: InternalBalancePlayer }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: player.uuid });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <PlayerCard player={player} dragging={isDragging} />
    </div>
  );
}

function DroppableRoleColumn({
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
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-36 flex-col gap-2 rounded-xl border border-dashed p-3 transition-colors",
        isOver ? "border-primary bg-primary/5" : "border-border/70 bg-muted/10",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{ROLE_LABELS[roleKey]}</span>
        <Badge variant="outline">
          {players.length}/{ROLE_CAPACITY[roleKey]}
        </Badge>
      </div>
      {players.map((player) => (
        <DraggablePlayer key={player.uuid} player={player} />
      ))}
      {players.length === 0 ? <div className="text-xs text-muted-foreground">Drop a player here</div> : null}
    </div>
  );
}

type BalanceEditorProps = {
  value: InternalBalancePayload | null;
  onChange: (payload: InternalBalancePayload) => void;
};

export const BalanceEditor = forwardRef<HTMLDivElement, BalanceEditorProps>(function BalanceEditor({ value, onChange }, ref) {
  const [activePlayer, setActivePlayer] = useState<InternalBalancePlayer | null>(null);
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

    setActivePlayer(value.teams[location.teamIndex].roster[location.roleKey][location.playerIndex]);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActivePlayer(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      return;
    }

    const from = findPlayerLocation(value, activeId);
    const target = parseContainerId(overId);
    if (!from || !target) {
      return;
    }

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

  const globalAvg = value.statistics?.averageMMR ?? (teamCards.length > 0 ? teamCards.reduce((s, t) => s + calculateTeamAverage(t), 0) / teamCards.length : 0);

  function getTeamDeviation(team: InternalBalancePayload["teams"][number]): number {
    if (!globalAvg) return 0;
    return Math.abs(calculateTeamAverage(team) - globalAvg);
  }

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

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => handleDragStart(String(event.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div ref={ref} className="grid gap-4 xl:grid-cols-2">
        {teamCards.map((team, teamIndex) => {
          const deviation = getTeamDeviation(team);
          const deviationLabel = deviation < 20 ? "Balanced" : deviation < 50 ? "Slight gap" : "Large gap";
          const deviationColor = deviation < 20 ? "text-emerald-500" : deviation < 50 ? "text-amber-500" : "text-destructive";
          const borderColor = TEAM_BORDER_COLORS[teamIndex % TEAM_BORDER_COLORS.length];
          return (
            <Card key={`${team.id}-${teamIndex}`} className={cn("rounded-2xl border-l-4 border-border/70 bg-card/80 shadow-sm", borderColor)}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <CardTitle className="text-base">{team.name}</CardTitle>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">Total: {calculateTeamTotal(team)}</span>
                  <span className="text-muted-foreground">Avg: {calculateTeamAverage(team).toFixed(0)}</span>
                  <span className={cn("font-medium", deviationColor)}>{deviationLabel}</span>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                {(Object.keys(team.roster) as BalancerRosterKey[]).map((roleKey) => (
                  <DroppableRoleColumn
                    key={`${team.id}-${roleKey}`}
                    containerId={`${teamIndex}:${roleKey}`}
                    roleKey={roleKey}
                    players={team.roster[roleKey]}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <DragOverlay>{activePlayer ? <PlayerCard player={activePlayer} /> : null}</DragOverlay>
    </DndContext>
  );
});
