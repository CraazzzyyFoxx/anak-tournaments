"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import captainService from "@/services/captain.service";
import encounterService from "@/services/encounter.service";
import heroService from "@/services/hero.service";
import mapService from "@/services/map.service";
import pickBanService, { type PickBanActionInput } from "@/services/pickBan.service";
import type { Encounter } from "@/types/encounter.types";
import type { PickBanAction, PickBanKind, PickBanState } from "@/types/tournament.types";

import {
  PICK_BAN_UNAVAILABLE_COPY,
  isSessionActive,
  pickBanReserveMap,
  pickedItemsInOrder,
  type PickBanSide,
  type PickBanUnavailableIcon,
} from "@/components/pick-ban/pick-ban-model";
import { PickBanCommandBar } from "@/components/pick-ban/PickBanCommandBar";
import { PickBanGrid, type PickBanItemLike } from "@/components/pick-ban/PickBanGrid";
import { PickBanStepTimeline } from "@/components/pick-ban/PickBanStepTimeline";
import { ElectOpenerDialog } from "@/components/pick-ban/ElectOpenerDialog";
import { MapReportDialog } from "@/components/pick-ban/MapReportDialog";
import { PregameAdminControls } from "./PregameAdminControls";
import { PregameHero } from "./PregameHero";
import { ReadinessModal } from "./ReadinessModal";

interface PregameRoomProps {
  encounterId: number;
}

/** One icon per cause, keyed by what `PICK_BAN_UNAVAILABLE_COPY` names. */
const UNAVAILABLE_ICON: Record<PickBanUnavailableIcon, React.ReactNode> = {
  teams: <ShieldAlert className="h-6 w-6 text-[color:var(--aqt-teal)]" aria-hidden />,
  unconfigured: <ShieldAlert className="h-6 w-6 text-[color:var(--aqt-amber)]" aria-hidden />,
  misconfigured: <ShieldAlert className="h-6 w-6 text-[color:var(--aqt-amber)]" aria-hidden />,
};

const PHASE_ORDER: PickBanKind[] = ["map", "hero"];

/**
 * Unified pre-game room: map veto and hero bans as one screen, sequential
 * steps (map decides the series' maps first; hero bans on the chosen maps
 * follow). Replaces the retired `VetoRoom`/`HeroBanRoom` pair — both kinds
 * run on the same generic `PickBanSession` engine, so one room renders
 * either with the same `PickBanGrid`/`PickBanStepTimeline`.
 *
 * Gated by `EncounterReadiness`: neither kind's session is created (backend:
 * `pick_ban_session.ensure_pick_ban_session`) until both captains confirm
 * readiness, shown here as a waiting screen with an "I'm ready" button.
 */
export function PregameRoom({ encounterId }: PregameRoomProps) {
  const t = useTranslations("pickBan.room");
  const queryClient = useQueryClient();
  const { isSuperuser, isWorkspaceAdmin, hasWorkspacePermission } = usePermissions();
  const enabled = Number.isFinite(encounterId) && encounterId > 0;

  const mapKey = ["pregame-state", encounterId, "map"];
  const heroKey = ["pregame-state", encounterId, "hero"];
  // Turn timeouts auto-resolve lazily server-side, the next time anyone
  // reads this session's state (backend: `pick_ban_action.auto_resolve_timeout`)
  // -- there's no push event for time simply elapsing on its own, so an
  // active, unresolved session polls itself close to real time instead of
  // waiting for the next manual action or page load to notice the clock
  // ran out.
  const mapQuery = useQuery({
    queryKey: mapKey,
    queryFn: () => pickBanService.getPickBanState("map", encounterId),
    enabled,
    refetchInterval: (query) => (query.state.data?.session != null && !query.state.data.is_complete ? 4000 : false),
  });
  const heroQuery = useQuery({
    queryKey: heroKey,
    queryFn: () => pickBanService.getPickBanState("hero", encounterId),
    enabled,
    refetchInterval: (query) => (query.state.data?.session != null && !query.state.data.is_complete ? 4000 : false),
  });
  const encounterQuery = useQuery({
    queryKey: ["encounter-detail", encounterId],
    queryFn: () => encounterService.getEncounter(encounterId),
    enabled,
  });
  const mapsQuery = useQuery({
    queryKey: ["maps-all"],
    queryFn: () => mapService.getAll({ perPage: -1 }),
    staleTime: 5 * 60 * 1000,
  });
  const heroesQuery = useQuery({
    queryKey: ["heroes-all"],
    queryFn: () => heroService.getAll({ perPage: -1 }),
    staleTime: 5 * 60 * 1000,
  });
  // `build_unavailable_state` reports `viewer_side: null` regardless of
  // identity (there is no session yet to resolve a side against), so the
  // readiness gate's "you're a captain" check needs its own read.
  const roleQuery = useQuery({
    queryKey: ["encounter", encounterId, "my-role"],
    queryFn: () => captainService.getMyRole(encounterId),
    enabled,
    retry: false,
  });

  // The hub only delivers a thin "changed" signal on every mutation — the
  // authoritative state is always refetched. Map keeps the legacy topic name
  // (`encounter:{id}:map-veto`); hero uses the generic kind-suffixed one.
  useRealtimeTopic(`encounter:${encounterId}:map-veto`, () => {
    void queryClient.invalidateQueries({ queryKey: mapKey });
  });
  useRealtimeTopic(`encounter:${encounterId}:pick-ban:hero`, () => {
    void queryClient.invalidateQueries({ queryKey: heroKey });
  });

  const readyMutation = useMutation({
    mutationFn: () => pickBanService.markReady(encounterId),
    onError: (error) => notify.apiError(error, { title: t("ready.failed") }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: mapKey });
      void queryClient.invalidateQueries({ queryKey: heroKey });
    },
  });

  const mapsById = useMemo(() => {
    const byId: Record<number, PickBanItemLike | undefined> = {};
    for (const map of mapsQuery.data?.results ?? []) byId[map.id] = map;
    return byId;
  }, [mapsQuery.data]);
  const heroesById = useMemo(() => {
    const byId: Record<number, PickBanItemLike | undefined> = {};
    for (const hero of heroesQuery.data?.results ?? []) byId[hero.id] = hero;
    return byId;
  }, [heroesQuery.data]);
  const itemsByKind: Record<PickBanKind, Record<number, PickBanItemLike | undefined>> = {
    map: mapsById,
    hero: heroesById,
  };

  if (mapQuery.isPending || heroQuery.isPending || encounterQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const encounter = encounterQuery.data ?? null;
  const mapState = mapQuery.data ?? null;
  const heroState = heroQuery.data ?? null;

  if (mapQuery.isError || heroQuery.isError || encounter === null || mapState === null || heroState === null) {
    return (
      <EmptyRoomCard
        icon={<ShieldAlert className="h-6 w-6 text-[color:var(--aqt-amber)]" aria-hidden />}
        title={t("loadError")}
        action={
          <Button
            onClick={() => {
              void mapQuery.refetch();
              void heroQuery.refetch();
              void encounterQuery.refetch();
            }}
          >
            {t("retry")}
          </Button>
        }
        encounterId={encounterId}
      />
    );
  }

  const statesByKind: Record<PickBanKind, PickBanState> = { map: mapState, hero: heroState };
  // "Applicable" = something WOULD open here once teams/rules/readiness allow
  // it — everything except "there is genuinely no rule set for this kind".
  const applicable = (kind: PickBanKind) => statesByKind[kind].reason !== "not_configured" || statesByKind[kind].session != null;
  const mapApplies = applicable("map");
  const heroApplies = applicable("hero");

  if (!mapApplies && !heroApplies) {
    return (
      <EmptyRoomCard
        icon={UNAVAILABLE_ICON.unconfigured}
        title={t("notConfiguredTitle")}
        hint={t("notConfiguredHint")}
        encounterId={encounterId}
      />
    );
  }

  const workspaceId = encounter.tournament?.workspace_id ?? null;
  const isAdmin =
    workspaceId != null && (isSuperuser || isWorkspaceAdmin(workspaceId) || hasWorkspacePermission(workspaceId, "match.update"));
  const viewerSide = roleQuery.data?.side ?? null;

  // Readiness blocks EVERY kind's session at once (one gate per encounter) --
  // any applicable kind reporting "not_ready" means the room as a whole is
  // waiting on captains, never a per-kind state.
  const readiness = mapState.readiness;
  const waitingOnReadiness =
    !(readiness.home && readiness.away) && PHASE_ORDER.some((kind) => applicable(kind) && statesByKind[kind].reason === "not_ready");

  // Map resolves first: stays the active phase until its session completes,
  // or it never applied to this encounter to begin with. Computed
  // unconditionally -- the readiness-wait branch below renders this same
  // header and phase list (with a null session) before any session exists,
  // so the room opens immediately instead of waiting behind a full-page gate.
  const mapDone = !mapApplies || (mapState.session != null && mapState.is_complete);
  const activeKind: PickBanKind = mapApplies && !mapDone ? "map" : "hero";
  const activeState = statesByKind[activeKind];
  const phases = PHASE_ORDER.filter((kind) => applicable(kind)).map((kind) => ({
    kind,
    applicable: true,
    done: kind === "map" ? mapDone : statesByKind[kind].session != null && statesByKind[kind].is_complete,
  }));

  if (waitingOnReadiness) {
    return (
      <div className="flex flex-col gap-4">
        <PregameHero encounter={encounter} session={activeState.session} activeKind={activeKind} phases={phases} />
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]" aria-hidden>
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
        <ReadinessModal
          readiness={readiness}
          viewerSide={viewerSide}
          pending={readyMutation.isPending}
          onReady={() => readyMutation.mutate()}
        />
      </div>
    );
  }

  if (activeState.session == null) {
    const copy = PICK_BAN_UNAVAILABLE_COPY[activeState.reason ?? "not_configured"];
    return (
      <EmptyRoomCard
        icon={UNAVAILABLE_ICON[copy.icon]}
        title={t(copy.titleKey)}
        hint={t(copy.hintKey)}
        encounterId={encounterId}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-32 sm:pb-28">
      <PregameHero encounter={encounter} session={activeState.session} activeKind={activeKind} phases={phases} />
      <PickBanPanel
        key={activeKind}
        kind={activeKind}
        encounterId={encounterId}
        encounter={encounter}
        state={activeState}
        session={activeState.session}
        queryKey={activeKind === "map" ? mapKey : heroKey}
        itemsById={itemsByKind[activeKind]}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function PickBanPanel({
  kind,
  encounterId,
  encounter,
  state,
  session,
  queryKey,
  itemsById,
  isAdmin,
}: {
  kind: PickBanKind;
  encounterId: number;
  encounter: Encounter;
  state: PickBanState;
  session: NonNullable<PickBanState["session"]>;
  queryKey: unknown[];
  itemsById: Record<number, PickBanItemLike | undefined>;
  isAdmin: boolean;
}) {
  const t = useTranslations("pickBan.room");
  const queryClient = useQueryClient();

  const [pickedItemId, setSelectedItemId] = useState<number | null>(null);
  const [reportMapId, setReportMapId] = useState<number | null>(null);
  const selectedItemId =
    pickedItemId != null && state.pool.some((entry) => entry.item_id === pickedItemId && entry.status === "available")
      ? pickedItemId
      : null;

  const actionMutation = useMutation({
    mutationFn: (input: PickBanActionInput) => pickBanService.performPickBanAction(kind, encounterId, input),
    onSuccess: () => setSelectedItemId(null),
    onError: (error) => notify.apiError(error, { title: t("captain.actionFailed") }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  });

  const sideName = (side: PickBanSide) =>
    side === "home" ? (encounter.home_team?.name ?? t("side.home")) : (encounter.away_team?.name ?? t("side.away"));

  const captainAction: PickBanAction | null =
    state.viewer_can_act && state.allowed_actions.length > 0 ? state.allowed_actions[0] : null;
  const canSelect = isSessionActive(session) && !state.is_complete && (captainAction !== null || isAdmin);
  const selectedItemName =
    selectedItemId != null ? (itemsById[selectedItemId]?.name ?? t(`${kind}.itemNumber`, { id: selectedItemId })) : null;
  const allowProtect = state.sequence.some((token) => token.startsWith("protect_"));

  // The backend enforces who may elect (pending_loser_side); this only gates
  // whether the losing captain's own client shows the modal at all.
  const showElectOpener = session.awaiting_choice && state.viewer_side === session.pending_loser_side;

  return (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        <PickBanStepTimeline
          kind={kind}
          sequence={state.sequence}
          pool={state.pool}
          currentStepIndex={state.current_step_index}
          isComplete={state.is_complete}
          currentRound={state.current_round}
          itemsById={itemsById}
          sideName={sideName}
        />
        <div className="flex flex-col gap-4">
          <PickBanGrid
            kind={kind}
            pool={state.pool}
            itemsById={itemsById}
            selectedItemId={selectedItemId}
            canSelect={canSelect}
            currentRound={state.current_round}
            slotReserves={pickBanReserveMap(session)}
            onSelect={(itemId) => setSelectedItemId((current) => (current === itemId ? null : itemId))}
          />

          {isAdmin ? (
            <PregameAdminControls
              kind={kind}
              encounterId={encounterId}
              state={state}
              allowProtect={allowProtect}
              selectedItemId={selectedItemId}
              selectedItemName={selectedItemName}
              onMutated={() => {
                setSelectedItemId(null);
                void queryClient.invalidateQueries({ queryKey });
              }}
            />
          ) : null}

          {kind === "map" && state.viewer_side != null && pickedItemsInOrder(state.pool).length > 0 ? (
            <section className="flex flex-col gap-2 rounded-xl border border-[color:var(--aqt-border)] p-3">
              <span className="text-sm font-medium">{t("reportResults.title")}</span>
              <div className="flex flex-wrap gap-2">
                {pickedItemsInOrder(state.pool).map((entry) => {
                  const mapName = itemsById[entry.item_id]?.name ?? t("map.itemNumber", { id: entry.item_id });
                  return (
                    <Button key={entry.id} size="sm" variant="outline" onClick={() => setReportMapId(entry.item_id)}>
                      {t("reportResults.button", { map: mapName })}
                    </Button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {isSessionActive(session) ? (
        <PickBanCommandBar
          state={state}
          session={session}
          sideName={sideName}
          captainAction={state.is_complete ? null : captainAction}
          selectedItemId={selectedItemId}
          selectedItemName={selectedItemName}
          pending={actionMutation.isPending}
          onConfirm={(itemId) => {
            if (captainAction != null) actionMutation.mutate({ item_id: itemId, action: captainAction });
          }}
          onCancel={() => setSelectedItemId(null)}
        />
      ) : null}

      {kind === "map" && reportMapId != null && state.viewer_side != null ? (
        <MapReportDialog
          encounterId={encounterId}
          mapId={reportMapId}
          mapName={itemsById[reportMapId]?.name ?? t("map.itemNumber", { id: reportMapId })}
          side={state.viewer_side}
          open={reportMapId != null}
          onOpenChange={(open) => setReportMapId(open ? reportMapId : null)}
          invalidateKeys={[queryKey, ["encounter-detail", encounterId]]}
        />
      ) : null}

      <ElectOpenerDialog
        kind={kind}
        encounterId={encounterId}
        open={showElectOpener}
        homeName={sideName("home")}
        awayName={sideName("away")}
        queryKey={queryKey}
      />
    </>
  );
}

function EmptyRoomCard({
  icon,
  title,
  hint,
  action,
  encounterId,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  encounterId: number;
}) {
  const t = useTranslations("pickBan.room");

  return (
    <Card>
      <CardContent className="flex min-h-[40svh] flex-col items-center justify-center gap-3 p-8 text-center">
        {icon}
        <h1 className="font-onest text-xl font-semibold">{title}</h1>
        {hint ? <p className="max-w-lg text-sm leading-relaxed text-[color:var(--aqt-fg-muted)]">{hint}</p> : null}
        <div className="mt-2 flex items-center gap-2">
          {action}
          <Button variant="outline" asChild>
            <Link href={`/encounters/${encounterId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              {t("back")}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
