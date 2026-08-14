"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CalendarOff, Clock, Map as MapIcon, SlidersHorizontal, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { PageStateCard } from "@/components/ui/page-state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import captainService from "@/services/captain.service";
import mapService from "@/services/map.service";
import type { MapRead } from "@/types/map.types";

import { VETO_UNAVAILABLE_COPY, slotReserveMaps, type VetoSide, type VetoUnavailableIcon } from "./veto-model";
import { VetoMapGrid } from "./VetoMapGrid";
import { VetoStepTimeline } from "./VetoStepTimeline";

interface EncounterMapPoolModalProps {
  encounterId: number;
  homeTeamName: string;
  awayTeamName: string;
}

/** One icon per cause, keyed by what `VETO_UNAVAILABLE_COPY` names. */
const UNAVAILABLE_ICON: Record<VetoUnavailableIcon, ReactNode> = {
  teams: <Users className="h-6 w-6 text-[color:var(--aqt-teal)]" aria-hidden />,
  unconfigured: <CalendarOff className="h-6 w-6 text-[color:var(--aqt-amber)]" aria-hidden />,
  misconfigured: <SlidersHorizontal className="h-6 w-6 text-[color:var(--aqt-amber)]" aria-hidden />,
  preview: <Clock className="h-6 w-6 text-[color:var(--aqt-fg-muted)]" aria-hidden />
};

/**
 * Read-only map-pool view for a bracket match, in a dialog instead of the full
 * veto room page. Reuses the room's own grid and step timeline — the only
 * difference is `canSelect={false}`: no captain actions, no admin controls, no
 * session hero. A spectator clicking through the bracket wants to see what got
 * banned/picked, not to act on it.
 */
export function EncounterMapPoolModal({
  encounterId,
  homeTeamName,
  awayTeamName
}: EncounterMapPoolModalProps) {
  const t = useTranslations();
  const tRoom = useTranslations("encounters.veto.room");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const stateQuery = useQuery({
    queryKey: ["encounter-veto-state", encounterId],
    queryFn: () => captainService.getMapPoolState(encounterId),
    enabled: open
  });
  // Same key/shape the veto room uses, so the two share one cache entry.
  const mapsQuery = useQuery({
    queryKey: ["maps-all"],
    queryFn: () => mapService.getAll({ perPage: -1 }),
    enabled: open,
    staleTime: 5 * 60_000
  });

  useRealtimeTopic(open ? `encounter:${encounterId}:map-veto` : null, () => {
    void queryClient.invalidateQueries({ queryKey: ["encounter-veto-state", encounterId] });
  });

  const mapsById = useMemo(() => {
    const byId: Record<number, MapRead | undefined> = {};
    for (const map of mapsQuery.data?.results ?? []) byId[map.id] = map;
    return byId;
  }, [mapsQuery.data]);

  const state = stateQuery.data ?? null;
  const sideName = (side: VetoSide) => (side === "home" ? homeTeamName : awayTeamName);

  let content: ReactNode;
  if (stateQuery.isPending || mapsQuery.isPending) {
    content = (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  } else if (stateQuery.isError || mapsQuery.isError || state === null) {
    content = (
      <PageStateCard
        state="error"
        onAction={() => {
          void stateQuery.refetch();
          void mapsQuery.refetch();
        }}
      />
    );
  } else if (!state.session) {
    const copy = VETO_UNAVAILABLE_COPY[state.reason ?? "not_configured"];
    content = (
      <div className="flex min-h-[30svh] flex-col items-center justify-center gap-3 p-8 text-center">
        {UNAVAILABLE_ICON[copy.icon]}
        <h3 className="font-onest text-lg font-semibold">{tRoom(copy.titleKey)}</h3>
        <p className="max-w-md text-sm leading-relaxed text-[color:var(--aqt-fg-muted)]">
          {tRoom(copy.hintKey)}
        </p>
      </div>
    );
  } else {
    const session = state.session;
    const turnBanner = state.is_complete
      ? tRoom("completedBanner")
      : state.expected_action === "decider"
        ? tRoom("deciderResolving")
        : state.turn_side && state.expected_action
          ? tRoom("turn", {
              side: sideName(state.turn_side),
              action: tRoom(`action.${state.expected_action}`)
            })
          : null;

    content = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={session.status === "active" ? "default" : "outline"}>
            {tRoom(`statusChip.${session.status}`)}
          </Badge>
          {turnBanner ? (
            <span className="text-sm text-[color:var(--aqt-fg-muted)]">{turnBanner}</span>
          ) : null}
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(220px,1fr)_2fr]">
          <VetoStepTimeline
            sequence={state.sequence}
            pool={state.pool}
            currentStepIndex={state.current_step_index}
            isComplete={state.is_complete}
            currentSlot={state.current_slot}
            mapsById={mapsById}
            sideName={sideName}
          />
          <VetoMapGrid
            pool={state.pool}
            mapsById={mapsById}
            selectedMapId={null}
            canSelect={false}
            currentSlot={state.current_slot}
            slotReserves={slotReserveMaps(session)}
            onSelect={() => {}}
          />
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="flex items-center justify-center rounded p-0.5 text-[color:var(--aqt-fg-muted)] outline-none transition-colors hover:bg-[color:var(--aqt-overlay-3)] hover:text-[color:var(--aqt-fg)]"
        aria-label={t("bracket.viewMapPool")}
        onClick={(e) => {
          // Keep any future card-level click handler from also firing.
          e.stopPropagation();
        }}
      >
        <MapIcon className="size-3.5" aria-hidden />
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-[95vw] max-w-[900px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b border-[color:var(--aqt-border)] p-4 pr-14 text-left">
          <DialogTitle>{t("bracket.mapPool.title")}</DialogTitle>
          <DialogDescription>
            {t("bracket.mapPool.description", { home: homeTeamName, away: awayTeamName })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-4">{content}</div>
      </DialogContent>
    </Dialog>
  );
}
