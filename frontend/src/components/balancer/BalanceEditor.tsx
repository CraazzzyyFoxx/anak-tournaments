"use client";

import { forwardRef, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { UserX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DivisionGrid } from "@/types/workspace.types";
import type {
  BalancerRosterKey,
  InternalBalancePayload,
  InternalBalancePlayer,
} from "@/types/balancer-admin.types";

import { BalanceEditorPlayerPreviewRow } from "./BalanceEditorPlayerRows";
import { BalanceEditorTeamCard } from "./BalanceEditorTeamCard";
import {
  getDraggedBalancePlayer,
  moveBalancePlayer,
  resolveBalanceDropTarget,
} from "./balance-editor-helpers";

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
      <div className="rounded-2xl border border-white/8 bg-white/2 px-4 py-6 text-sm text-white/45">
        Run the balancer to edit teams.
      </div>
    );
  }

  const handleDragStart = (playerId: string) => {
    setActivePlayer(getDraggedBalancePlayer(value, playerId));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActivePlayer(null);
    const nextPayload = moveBalancePlayer(
      value,
      String(event.active.id),
      resolveBalanceDropTarget(
        event.over ? String(event.over.id) : null,
        event.over?.data.current,
      ),
    );

    if (nextPayload) {
      onChange(nextPayload);
    }
  };

  const benchedPlayers = value.benched_players ?? [];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => handleDragStart(String(event.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div ref={ref} className="space-y-4">
        {benchedPlayers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/5 px-4 py-3">
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

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-3">
          {teamCards.map((team, teamIndex) => (
            <BalanceEditorTeamCard
              key={`${team.id}-${teamIndex}`}
              team={team}
              teamIndex={teamIndex}
              divisionGrid={divisionGrid}
              selectedPlayerId={selectedPlayerId}
              collapsed={collapsedTeamIds.includes(team.id)}
              onSelectPlayer={onSelectPlayer}
              onToggleTeam={onToggleTeam}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activePlayer ? (
          <BalanceEditorPlayerPreviewRow
            player={activePlayer.player}
            roleKey={activePlayer.roleKey}
            divisionGrid={divisionGrid}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});
