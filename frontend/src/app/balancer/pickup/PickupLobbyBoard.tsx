"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Copy, Loader2, X } from "lucide-react";

import { PickupResultControls } from "@/app/balancer/pickup/PickupResultControls";
import { teamAccent } from "@/app/balancer/pickup/pickup-chrome";
import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNodeCapture } from "@/hooks/useNodeCapture";
import { OW_REFERENCE_GRID, resolveDivisionFromRank } from "@/lib/division-grid";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { CustomGameOutcome } from "@/services/custom-game.service";
import type { LookupItem } from "@/types/pagination.types";

import type { PickupRecordOutcomeInput, PickupTeam, PickupVariant } from "./pickup-lineup";


type PickupLobbyBoardProps = {
  mixName: string;
  variant: PickupVariant;
  variantIndex: number;
  variantCount: number;
  onVariantIndexChange: (index: number) => void;
  outcome: CustomGameOutcome | null;
  canWrite: boolean;
  recordingOutcome: boolean;
  onRecordOutcome: (input: PickupRecordOutcomeInput) => void;
  maps: LookupItem[];
  mapId: number | null;
  onMapIdChange: (mapId: number | null) => void;
  onClose: () => void;
};

/**
 * The matchup at call-out size.
 *
 * This is the screen a host shares or projects while reading teams to a lobby,
 * so every element that only matters while *editing* is gone and what is left —
 * name, division, rating — is sized to be legible from across a room or through
 * a stream's compression. The two halves mirror each other so each team's crests
 * hug the outer edge and the names meet in the middle, which is what makes a
 * pair read as one matchup rather than two lists.
 *
 * The result controls and the option pager stay, because they are the two things
 * a host does *from* this screen: page to a fairer option while people complain,
 * then log who won without navigating away.
 */
export function PickupLobbyBoard({
  mixName,
  variant,
  variantIndex,
  variantCount,
  onVariantIndexChange,
  outcome,
  canWrite,
  recordingOutcome,
  onRecordOutcome,
  maps,
  mapId,
  onMapIdChange,
  onClose,
}: Readonly<PickupLobbyBoardProps>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && variantIndex < variantCount - 1) {
        onVariantIndexChange(variantIndex + 1);
      }
      if (event.key === "ArrowLeft" && variantIndex > 0) {
        onVariantIndexChange(variantIndex - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onVariantIndexChange, variantIndex, variantCount]);

  const { stats } = variant;

  // Rasterise the board itself rather than build a separate export layout: this
  // screen already IS the shareable artifact, so the image a host sends is the
  // one they were just looking at.
  const { ref: captureRef, capturing, capture } = useNodeCapture();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${mixName} — lobby board`}
      className="fixed inset-0 z-50 overflow-y-auto bg-[color:var(--aqt-bg)]"
    >
      {/* Decoration only, and pointer-events-none so it never eats a click on a
          control underneath: a faint grid for depth, one warm pool of light at
          the top, and the accent hairline the rest of the app uses for a hero. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(0_0%_100%/.022)_1px,transparent_1px),linear-gradient(90deg,hsl(0_0%_100%/.022)_1px,transparent_1px)] bg-[length:48px_48px] [mask-image:radial-gradient(120%_90%_at_50%_0%,#000_20%,transparent_75%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-64 left-1/2 h-[620px] w-[1200px] -translate-x-1/2 bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--aqt-teal)_10%,transparent),transparent)]"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-[color:var(--aqt-teal)]" />

      <div
        ref={captureRef}
        className={cn(
          "relative px-6 pb-10 pt-6 md:px-12",
          capturing && "[&_[data-export-hide]]:invisible",
        )}
      >
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]">
            {mixName}
          </span>
          {/* Stats stay in the image — they are the reason a lobby trusts the
              teams. Only the controls are stripped. */}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            {stats.compositeScore == null ? null : (
              <BoardStat label="Quality" value={stats.compositeScore.toFixed(2)} />
            )}
            {stats.mmrStdDev == null ? null : (
              <BoardStat label="StdDev" value={stats.mmrStdDev.toFixed(1)} />
            )}
            <BoardStat label="Off-role" value={String(stats.offRoleCount ?? 0)} />
            <span data-export-hide className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                disabled={capturing}
                onClick={() => void capture()}
              >
                {capturing ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Copy className="mr-1.5 size-3.5" aria-hidden="true" />
                )}
                Copy image
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={onClose}>
                <X className="mr-1.5 size-3.5" aria-hidden="true" />
                Exit &middot; Esc
              </Button>
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-6">
          {variant.teams.map((team, teamIndex) => (
            <BoardTeamTitle
              key={team.id}
              team={team}
              teamIndex={teamIndex}
              mirrored={teamIndex > 0}
            />
          ))}
        </div>

        <div className="mt-7 flex flex-col gap-7 lg:flex-row">
          {variant.teams.map((team, teamIndex) => (
            <div key={team.id} className="min-w-0 flex-1 space-y-1.5">
              {team.seats.map((seat) => (
                <BoardSeat
                  key={`${seat.uuid}:${seat.role}`}
                  seat={seat}
                  teamIndex={teamIndex}
                  mirrored={teamIndex > 0}
                />
              ))}
            </div>
          ))}
        </div>

        <div
          data-export-hide
          className="mt-7 flex flex-wrap items-center gap-3 border-t border-[color:var(--aqt-border)] pt-4"
        >
          {canWrite ? (
            <Select
              value={mapId == null ? "none" : String(mapId)}
              onValueChange={(value) => onMapIdChange(value === "none" ? null : Number(value))}
            >
              <SelectTrigger className="h-[38px] w-[170px] rounded-lg border-[color:var(--aqt-border)] bg-white/[0.015] text-[13px]">
                <SelectValue placeholder="Map (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No map</SelectItem>
                {maps.map((map) => (
                  <SelectItem key={map.id} value={String(map.id)}>
                    {map.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <PickupResultControls
            teamCount={variant.teams.length}
            teamNames={variant.teams.map((team) => team.name)}
            outcome={outcome}
            canRecord={canWrite}
            saving={recordingOutcome}
            size="lg"
            onRecord={(recordedOutcome) => onRecordOutcome({ outcome: recordedOutcome, variantIndex, mapId })}
          />
          {variantCount > 1 ? (
            <span className="ml-auto flex h-[38px] items-center gap-0.5 rounded-lg border border-[color:var(--aqt-border)] px-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={variantIndex === 0}
                onClick={() => onVariantIndexChange(variantIndex - 1)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                <span className="sr-only">Previous balance option</span>
              </Button>
              <span className="min-w-14 px-1 text-center font-mono text-[13px] font-semibold tabular-nums text-[color:var(--aqt-fg-muted)]">
                {`${variantIndex + 1} / ${variantCount}`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={variantIndex >= variantCount - 1}
                onClick={() => onVariantIndexChange(variantIndex + 1)}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
                <span className="sr-only">Next balance option</span>
              </Button>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BoardStat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <span className="font-mono text-xs uppercase tracking-[0.1em] tabular-nums text-[color:var(--aqt-fg-faint)]">
      {`${label} ${value}`}
    </span>
  );
}

function BoardTeamTitle({
  team,
  teamIndex,
  mirrored,
}: Readonly<{ team: PickupTeam; teamIndex: number; mirrored: boolean }>) {
  const accent = teamAccent(teamIndex);

  return (
    <div className={cn("min-w-0 flex-1", mirrored && "lg:text-right")}>
      <div className="truncate font-display text-5xl font-extrabold leading-none tracking-[-0.02em] text-[color:var(--aqt-fg)] md:text-[76px]">
        {team.name}
      </div>
      <div
        className={cn(
          "mt-2.5 flex items-baseline gap-2.5",
          mirrored && "lg:flex-row-reverse",
        )}
      >
        <span aria-hidden="true" className={cn("block h-0.5 w-7", accent.bar)} />
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--aqt-fg-dim)]">
          avg
        </span>
        <span className="font-mono text-2xl font-bold tabular-nums text-[color:var(--aqt-fg)]">
          {team.averageRank == null ? "\u2014" : Math.round(team.averageRank)}
        </span>
      </div>
    </div>
  );
}

function BoardSeat({
  seat,
  teamIndex,
  mirrored,
}: Readonly<{ seat: PickupTeam["seats"][number]; teamIndex: number; mirrored: boolean }>) {
  // The global OW grid, not the workspace's: balancer-service resolves a mix's
  // ranks against the grid with `workspace_id=None`, so `seat.rating` is on the
  // OW scale. Labelling it with a workspace's tiers renames the same number.
  const grid = OW_REFERENCE_GRID;
  const accent = teamAccent(teamIndex);
  const division = resolveDivisionFromRank(grid, seat.rating);
  const icon = ROLES.find((item) => item.code === seat.role)?.icon ?? "Support";

  const crest = (
    <div
      className={cn(
        "flex w-24 shrink-0 flex-col items-center justify-center gap-0.5 md:w-26",
        accent.crestPanel,
        mirrored ? cn("border-l", accent.crestBorder) : cn("border-r", accent.crestBorder),
      )}
    >
      {division == null ? null : (
        <DivisionIcon division={division} tournamentGrid={grid} width={52} height={52} />
      )}
      <span className="font-mono text-[19px] font-bold tabular-nums text-[color:var(--aqt-fg)]">
        {seat.rating == null ? "\u2014" : Math.round(seat.rating)}
      </span>
    </div>
  );

  return (
    <div
      className={cn(
        "flex h-[104px] items-stretch overflow-hidden rounded-xl border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card)]",
        mirrored && "flex-row-reverse",
      )}
    >
      {crest}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3.5 px-5",
          mirrored && "flex-row-reverse",
        )}
      >
        <span className="truncate font-display text-3xl font-bold leading-none tracking-[-0.01em] text-[color:var(--aqt-fg)] md:text-[40px]">
          {seat.name}
        </span>
        {seat.offRole ? (
          <span
            title="Assigned off their first-preference role"
            className="shrink-0 rounded border border-[color:color-mix(in_srgb,var(--aqt-amber)_30%,transparent)] px-1.5 py-px font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--aqt-amber)]"
          >
            Off-role
          </span>
        ) : null}
        {/* The role glyph is a confirmation, not the headline: it sits at the far
            edge at low opacity so the name owns the row. */}
        <span
          className={cn("shrink-0 opacity-45", mirrored ? "mr-auto" : "ml-auto")}
          title={ROLE_LABELS[seat.role]}
        >
          <PlayerRoleIcon role={icon} size={40} label={ROLE_LABELS[seat.role]} />
        </span>
      </div>
    </div>
  );
}
