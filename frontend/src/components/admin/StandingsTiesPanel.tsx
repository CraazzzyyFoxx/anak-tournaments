"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

import TeamName from "@/components/TeamName";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { Stage, Standings } from "@/types/tournament.types";

/** A run of rows the engine could not separate: same `tie_group`, same scope. */
export interface TieCluster {
  key: string;
  stageId: number;
  /** The cluster's first absolute 1-based position, i.e. its `tie_group`. */
  head: number;
  scope: string;
  rows: Standings[];
}

/**
 * Group displayed rows into tie clusters.
 *
 * `tie_group` is a position, so the same value repeats across groups and
 * stages: the scope has to be part of the key or two unrelated ties merge into
 * one card. Rows with no stage are skipped — `manual_positions` lives on a
 * stage, so there is nowhere to store an order for them.
 */
export function tieClusters(rows: Standings[]): TieCluster[] {
  const byKey = new Map<string, TieCluster>();
  for (const row of rows) {
    if (row.tie_group == null || row.stage_id == null) continue;
    const key = `${row.stage_id}:${row.stage_item_id ?? "-"}:${row.tie_group}`;
    const cluster = byKey.get(key);
    if (cluster) {
      cluster.rows.push(row);
      continue;
    }
    byKey.set(key, {
      key,
      stageId: row.stage_id,
      head: row.tie_group,
      scope: row.stage_item?.name ?? row.stage?.name ?? "Unassigned",
      rows: [row]
    });
  }
  return [...byKey.values()]
    .filter((cluster) => cluster.rows.length > 1)
    .map((cluster) => ({
      ...cluster,
      rows: [...cluster.rows].sort((a, b) => a.position - b.position)
    }))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.head - b.head);
}

/** The stage's stored overrides, as a mutable copy. */
function manualPositionsOf(stage: Stage | undefined): Record<string, number> {
  const raw = stage?.settings_json?.manual_positions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, number>) };
}

/**
 * The organizer's control for ties the engine left unresolved.
 *
 * A cluster means the rows were equal on every configured tiebreaker, so the
 * order shown was assigned (organizer override, else team id) rather than
 * earned. Saving writes absolute positions into the stage's
 * `manual_positions`, which the `manual_override` tiebreaker reads — so the
 * order has to be followed by a recalculation to reach the table. A cluster
 * stays marked after a save: the override decides the order, it does not make
 * the teams unequal.
 */
export function StandingsTiesPanel({
  rows,
  stages,
  tournamentId,
  canUpdate,
  onChanged
}: Readonly<{
  rows: Standings[];
  stages: Stage[];
  tournamentId: number;
  canUpdate: boolean;
  onChanged: () => void;
}>) {
  const clusters = useMemo(() => tieClusters(rows), [rows]);
  const stageById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);

  const [order, setOrder] = useState<Record<string, number[]>>({});

  // Once a save round-trips, the refetched rows carry the new order; a kept
  // local one would keep the card marked dirty against itself. Keyed on the
  // rows themselves, not the array identity, so a background refetch that
  // changes nothing does not discard an in-progress reorder. Cleared during
  // render rather than in an effect, so the row list and the pending order it
  // is indexed by are never committed out of step with each other.
  const signature = clusters
    .map((cluster) => `${cluster.key}=${cluster.rows.map((row) => row.team_id).join(",")}`)
    .join("|");
  const [seenSignature, setSeenSignature] = useState(signature);
  if (seenSignature !== signature) {
    setSeenSignature(signature);
    setOrder({});
  }

  const mutation = useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: async ({
      cluster,
      teamIds
    }: {
      cluster: TieCluster;
      /** `null` clears this cluster's overrides instead of setting them. */
      teamIds: number[] | null;
    }) => {
      const stage = stageById.get(cluster.stageId);
      const positions = manualPositionsOf(stage);
      if (teamIds) {
        teamIds.forEach((teamId, index) => {
          positions[String(teamId)] = cluster.head + index;
        });
      } else {
        for (const row of cluster.rows) delete positions[String(row.team_id)];
      }
      await adminService.updateStage(cluster.stageId, {
        settings_json: { ...(stage?.settings_json ?? {}), manual_positions: positions }
      });
      // The override is only read while ranking, so without this the stage
      // stores an order the table never shows.
      await adminService.recalculateStandings(tournamentId);
    },
    onSuccess: (_result, variables) => {
      setOrder({});
      onChanged();
      notify.success(
        variables.teamIds ? "Tie order saved and standings recalculated" : "Tie order reset"
      );
    },
    onError: (error) => notify.apiError(error)
  });

  if (clusters.length === 0) return null;

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Unresolved ties</h3>
        <p className="text-xs text-muted-foreground">
          These teams were equal on every configured tiebreaker, so their order was assigned
          rather than earned. Reordering stores absolute positions the engine re-applies on
          every recalculation.
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {clusters.map((cluster) => {
          const current = order[cluster.key] ?? cluster.rows.map((row) => row.team_id);
          const dirty = current.some((teamId, index) => teamId !== cluster.rows[index]?.team_id);
          const busy = mutation.isPending;

          const move = (index: number, delta: number) => {
            const target = index + delta;
            if (target < 0 || target >= current.length) return;
            const next = [...current];
            next[index] = current[target];
            next[target] = current[index];
            setOrder((prev) => ({ ...prev, [cluster.key]: next }));
          };

          return (
            <div key={cluster.key} className="rounded-lg border p-3">
              <p className="text-sm font-medium">
                <span className="tabular-nums">
                  {cluster.head}–{cluster.head + cluster.rows.length - 1}
                </span>
                <span className="text-muted-foreground"> · {cluster.scope}</span>
              </p>
              <ol className="mt-2 space-y-1">
                {current.map((teamId, index) => {
                  const row = cluster.rows.find((entry) => entry.team_id === teamId);
                  const name = row?.team?.name ?? `team #${teamId}`;
                  return (
                    <li key={teamId} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-sm font-bold tabular-nums">
                        {cluster.head + index}
                      </span>
                      <div className="min-w-0 flex-1">
                        {row?.team ? <TeamName team={row.team} size="xs" /> : name}
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {row?.points.toFixed(1) ?? "—"} pts
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${name} up`}
                        disabled={!canUpdate || busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ChevronUp aria-hidden className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${name} down`}
                        disabled={!canUpdate || busy || index === current.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ChevronDown aria-hidden className="size-4" />
                      </Button>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canUpdate || busy}
                  onClick={() => mutation.mutate({ cluster, teamIds: null })}
                >
                  <RotateCcw aria-hidden className="size-4" />
                  Reset
                </Button>
                <Button
                  size="sm"
                  disabled={!canUpdate || busy || !dirty}
                  onClick={() => mutation.mutate({ cluster, teamIds: current })}
                >
                  Save order
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
