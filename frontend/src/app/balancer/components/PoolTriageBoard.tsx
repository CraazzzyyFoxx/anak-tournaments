"use client";

import { useMemo } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical, Pencil, ShieldX } from "lucide-react";

import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDragSensors } from "@/hooks/useDragSensors";
import { cn } from "@/lib/utils";
import type { AdminRegistration, BalancerPlayerRecord, BalancerRoleCode } from "@/types/balancer-admin.types";
import { roleTint, type RoleOntology } from "@/lib/roster/ontology";
import type { DivisionGrid } from "@/types/workspace.types";
import {
  POOL_LANES,
  POOL_LANE_LABELS,
  derivePoolLane,
  hasBlockingIssues,
  getPoolDropPatch,
  type PlayerValidationState,
  type PoolLane,
} from "@/components/balancer/balancer-page-helpers";
import { HandleLabel } from "@/components/HandleLabel";
import { AdditionalHandleStrip, HandleContextMenuItems, HandleCopyButton } from "./HandleCopyControls";
import { isRoleEntryActive } from "@/components/balancer/workspace-helpers";
import { IssueChip, issueChipKey } from "./IssueChip";

import { BalancerStatusContextMenuItems, BalancerStatusMenu, type StatusOptionGroups } from "./BalancerStatusMenu";

type PoolTriageBoardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerStates: PlayerValidationState[];
  /** The tournament owner's role dictionary: role glyphs and tints. `null` while it loads. */
  ontology: RoleOntology | null;
  /** The owner game's grid the cards' division crests resolve in. */
  divisionGrid: DivisionGrid;
  registrationsById?: Map<number, AdminRegistration>;
  statusOptions?: StatusOptionGroups;
  selectedPlayerId?: number | null;
  onSelectPlayer: (playerId: number | null) => void;
  onSetPoolMembership?: (playerId: number, isInPool: boolean) => unknown;
  onSetBalancerStatus?: (playerId: number, balancerStatus: string) => unknown;
  actionsDisabled?: boolean;
};

const LANE_ACCENTS: Record<PoolLane, string> = {
  // Neutral/inactive lane: overlay tokens instead of a hue, so it reads as
  // "no accent" beside the amber and emerald lanes.
  excluded: "border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)]",
  needs_fix: "border-amber-300/20 bg-amber-500/[0.07]",
  ready: "border-emerald-300/20 bg-emerald-500/[0.07]",
};

const LANE_COPY: Record<PoolLane, string> = {
  excluded: "Drop here to remove from the run.",
  needs_fix: "Included, but validation still needs attention.",
  ready: "Included and ready for balancing.",
};

function sortRoleEntries(player: BalancerPlayerRecord) {
  return [...player.role_entries_json].sort((left, right) => left.priority - right.priority);
}

function uniqueRoleCodes(roleCodes: BalancerRoleCode[]): BalancerRoleCode[] {
  return roleCodes.filter((roleCode, index) => roleCodes.indexOf(roleCode) === index);
}

function isCardActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-card-action]") !== null;
}

function TriagePlayerCard({
  state,
  registration,
  ontology,
  divisionGrid,
  statusOptions,
  selectedPlayerId,
  actionsDisabled,
  onSelectPlayer,
  onSetPoolMembership,
  onSetBalancerStatus,
}: Readonly<{
  state: PlayerValidationState;
  registration: AdminRegistration | null;
  statusOptions?: StatusOptionGroups;
  ontology: RoleOntology | null;
  divisionGrid: DivisionGrid;
  selectedPlayerId?: number | null;
  actionsDisabled?: boolean;
  onSelectPlayer: (playerId: number | null) => void;
  onSetPoolMembership?: (playerId: number, isInPool: boolean) => unknown;
  onSetBalancerStatus?: (playerId: number, balancerStatus: string) => unknown;
}>) {
  const lane = derivePoolLane(state);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pool-player:${state.player.id}`,
    data: { playerId: state.player.id, lane },
    // Dragging out of Excluded would include the player; that only happens through a status change.
    disabled: actionsDisabled || !onSetPoolMembership || !state.player.is_in_pool,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const sortedEntries = sortRoleEntries(state.player);
  const rankedEntries = sortedEntries.filter((entry) => isRoleEntryActive(entry) && entry.rank_value !== null);
  const rankedRoleCodes = uniqueRoleCodes(rankedEntries.map((entry) => entry.role));
  const primaryEntry = rankedEntries[0] ?? sortedEntries[0] ?? null;
  const primaryRole = primaryEntry?.role ?? null;
  const isSelected = selectedPlayerId === state.player.id;
  const handles = [state.player.identity, ...state.player.additional_handles];
  const isReady = state.player.is_in_pool && !hasBlockingIssues(state.issues);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            "cursor-pointer rounded-xl border border-border bg-card p-2.5 transition",
            isSelected && "border-primary/45 bg-primary/[0.08]",
            isDragging && "z-50 scale-[1.02] opacity-80 shadow-[0_22px_56px_rgba(0,0,0,0.34)]",
          )}
          title={state.player.identity}
        >
          <div className="flex items-start gap-2">
            {state.player.is_in_pool ? (
              <button
                type="button"
                data-card-action
                className="mt-0.5 flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-bg-2)] text-[color:var(--aqt-fg-dim)] hover:text-[color:var(--aqt-fg)] active:cursor-grabbing"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-3.5 w-3.5" />
                <span className="sr-only">Drag player</span>
              </button>
            ) : null}

            <div className="min-w-0 flex-1">
              <button
                type="button"
                data-card-action
                onClick={() => onSelectPlayer(state.player.id)}
                title={`Edit ${state.player.identity}`}
                className="w-full min-w-0 rounded text-left"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {rankedRoleCodes.length > 0 ? (
                    rankedRoleCodes.map((roleCode) => (
                      <PlayerRoleIcon key={roleCode} role={roleCode} ontology={ontology} size={15} />
                    ))
                  ) : (
                    <span className="text-label text-[color:var(--aqt-fg-faint)]">No roles</span>
                  )}
                  <HandleLabel
                    handle={state.player.identity}
                    className="text-caption font-semibold text-[color:var(--aqt-fg)]"
                    tagClassName="text-label"
                  />
                </span>
              </button>
              {state.player.is_flex || isReady || state.issues.length > 0 || state.player.additional_handles.length > 0 ? (
                <div className="mt-1 flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {state.player.is_flex ? (
                    <span className="shrink-0 rounded-full border border-violet-300/20 bg-violet-500/12 px-1.5 py-0.5 text-label font-semibold uppercase tracking-label text-violet-200">
                      Flex
                    </span>
                  ) : null}
                  {isReady ? (
                    <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-1.5 py-0.5 text-label font-semibold uppercase tracking-label text-emerald-200">
                      Ready
                    </span>
                  ) : null}
                  {state.issues.map((issue) => (
                    <IssueChip
                      key={`${state.player.id}-${issueChipKey(issue)}`}
                      issue={issue}
                      ontology={ontology}
                      divisionGrid={divisionGrid}
                    />
                  ))}
                  <AdditionalHandleStrip additionalHandles={state.player.additional_handles} compact />
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {primaryEntry?.division_number != null ? (
                <DivisionIcon division={primaryEntry.division_number} tournamentGrid={divisionGrid} width={20} height={20} />
              ) : null}
              {primaryEntry?.rank_value != null ? (
                <span
                  className="min-w-10 text-right text-caption font-semibold tabular-nums text-cyan-300"
                  style={primaryRole ? { color: roleTint(ontology, primaryRole) } : undefined}
                >
                  {primaryEntry.rank_value}
                </span>
              ) : (
                <span className="text-label text-[color:var(--aqt-fg-faint)]">-</span>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2" data-card-action>
            <BalancerStatusMenu
              size="compact"
              value={registration?.balancer_status}
              statusOptions={statusOptions}
              disabled={actionsDisabled}
              onChange={registration ? (status) => onSetBalancerStatus?.(state.player.id, status) : undefined}
            />
            <div className="flex items-center gap-1">
              <HandleCopyButton handle={state.player.identity} className="h-7 w-7" />
              {state.player.is_in_pool ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={actionsDisabled || !onSetPoolMembership}
                  className="h-7 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)] px-2 text-[color:var(--aqt-fg-muted)] hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)]"
                  onClick={() => onSetPoolMembership?.(state.player.id, false)}
                >
                  <ShieldX className="mr-1 h-3 w-3" />
                  Exclude
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>Player actions</ContextMenuLabel>
        <ContextMenuItem onClick={() => onSelectPlayer(state.player.id)}>
          <Pencil className="h-4 w-4" />
          Edit full profile
        </ContextMenuItem>
        <HandleContextMenuItems handles={handles} />
        {onSetPoolMembership && state.player.is_in_pool ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={actionsDisabled} onClick={() => onSetPoolMembership(state.player.id, false)}>
              <ShieldX className="h-4 w-4" />
              Exclude from balancer
            </ContextMenuItem>
          </>
        ) : null}
        <BalancerStatusContextMenuItems
          value={registration?.balancer_status}
          statusOptions={statusOptions}
          disabled={actionsDisabled}
          onChange={registration ? (status) => onSetBalancerStatus?.(state.player.id, status) : undefined}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TriageLaneColumn({
  lane,
  states,
  ontology,
  divisionGrid,
  registrationsById,
  statusOptions,
  selectedPlayerId,
  actionsDisabled,
  onSelectPlayer,
  onSetPoolMembership,
  onSetBalancerStatus,
}: Readonly<{
  lane: PoolLane;
  states: PlayerValidationState[];
  ontology: RoleOntology | null;
  divisionGrid: DivisionGrid;
  registrationsById?: Map<number, AdminRegistration>;
  statusOptions?: StatusOptionGroups;
  selectedPlayerId?: number | null;
  actionsDisabled?: boolean;
  onSelectPlayer: (playerId: number | null) => void;
  onSetPoolMembership?: (playerId: number, isInPool: boolean) => unknown;
  onSetBalancerStatus?: (playerId: number, balancerStatus: string) => unknown;
}>) {
  const { setNodeRef, isOver } = useDroppable({
    id: `pool-lane:${lane}`,
    data: { lane },
    disabled: actionsDisabled || !onSetPoolMembership,
  });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex min-h-0 flex-col rounded-2xl border p-3 transition",
        LANE_ACCENTS[lane],
        isOver && "border-primary/60 bg-primary/[0.12]",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--aqt-fg)]">{POOL_LANE_LABELS[lane]}</div>
          <div className="mt-0.5 text-label text-[color:var(--aqt-fg-dim)]">{LANE_COPY[lane]}</div>
        </div>
        <div className="rounded-full border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-bg-2)] px-2 py-0.5 text-label font-semibold tabular-nums text-[color:var(--aqt-fg-muted)]">
          {states.length}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {states.length > 0 ? (
          // The click sits on the `<li>`, not on the card's own `div`: the card
          // is a drag source and a plain `div`, and `onClick` on a
          // non-interactive `div` is what the design gate rejects. Subtrees
          // marked `data-card-action` (grip, pool toggle, status menu, copy
          // controls) keep their own clicks.
          <ul aria-label={`${POOL_LANE_LABELS[lane]} players`} className="space-y-2 pr-2">
            {states.map((state) => (
              <li
                key={state.player.id}
                onClick={(event) => {
                  if (isCardActionTarget(event.target)) {
                    return;
                  }
                  onSelectPlayer(state.player.id);
                }}
              >
                <TriagePlayerCard
                  state={state}
                  registration={registrationsById?.get(state.player.id) ?? null}
                  ontology={ontology}
                  divisionGrid={divisionGrid}
                  statusOptions={statusOptions}
                  selectedPlayerId={selectedPlayerId}
                  actionsDisabled={actionsDisabled}
                  onSelectPlayer={onSelectPlayer}
                  onSetPoolMembership={onSetPoolMembership}
                  onSetBalancerStatus={onSetBalancerStatus}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-bg-2)] px-3 py-8 text-center text-xs text-[color:var(--aqt-fg-dim)]">
            Drop players here
          </div>
        )}
      </ScrollArea>
    </section>
  );
}

export function PoolTriageBoard({
  open,
  onOpenChange,
  playerStates,
  ontology,
  divisionGrid,
  registrationsById,
  statusOptions,
  selectedPlayerId,
  onSelectPlayer,
  onSetPoolMembership,
  onSetBalancerStatus,
  actionsDisabled = false,
}: Readonly<PoolTriageBoardProps>) {
  const sensors = useDragSensors();
  const statesByLane = useMemo(
    () =>
      POOL_LANES.reduce<Record<PoolLane, PlayerValidationState[]>>(
        (acc, lane) => {
          acc[lane] = playerStates.filter((state) => derivePoolLane(state) === lane);
          return acc;
        },
        { excluded: [], needs_fix: [], ready: [] },
      ),
    [playerStates],
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const playerId = event.active.data.current?.playerId as number | undefined;
    const targetLane = event.over?.data.current?.lane as PoolLane | undefined;
    if (!playerId || !targetLane || !onSetPoolMembership) {
      return;
    }

    const currentState = playerStates.find((state) => state.player.id === playerId);
    if (!currentState) {
      return;
    }

    const patch = getPoolDropPatch(targetLane);
    if (currentState.player.is_in_pool === patch.is_in_pool) {
      return;
    }

    await onSetPoolMembership(playerId, patch.is_in_pool);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="panel" className="h-[min(760px,calc(100vh-3rem))] w-[min(1180px,calc(100vw-2rem))] max-w-none">
        <DialogHeader variant="panel">
          <DialogTitle className="text-base text-[color:var(--aqt-fg)]">Balancing Pool triage</DialogTitle>
          <DialogDescription className="text-xs text-[color:var(--aqt-fg-dim)]">
            Drag players into Excluded to remove them from the run; excluded players come back through a balancer status change. Need Fix and Ready are computed from validation, so included players settle into the correct lane automatically.
          </DialogDescription>
        </DialogHeader>
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="grid min-h-0 flex-1 gap-3 p-4 lg:grid-cols-3">
            {POOL_LANES.map((lane) => (
              <TriageLaneColumn
                key={lane}
                lane={lane}
                states={statesByLane[lane]}
                ontology={ontology}
                divisionGrid={divisionGrid}
                registrationsById={registrationsById}
                statusOptions={statusOptions}
                selectedPlayerId={selectedPlayerId}
                actionsDisabled={actionsDisabled}
                onSelectPlayer={onSelectPlayer}
                onSetPoolMembership={onSetPoolMembership}
                onSetBalancerStatus={onSetBalancerStatus}
              />
            ))}
          </div>
        </DndContext>
      </DialogContent>
    </Dialog>
  );
}
