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
import captainService from "@/services/captain.service";
import encounterService from "@/services/encounter.service";
import heroService from "@/services/hero.service";
import mapService from "@/services/map.service";
import pickBanService, { type PickBanActionInput } from "@/services/pickBan.service";
import type { Encounter } from "@/types/encounter.types";
import type { PickBanAction, PickBanKind, PickBanState } from "@/types/tournament.types";

import {
  PICK_BAN_UNAVAILABLE_COPY,
  highestPoolRound,
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
import { PregameAdminControls } from "./PregameAdminControls";
import { PregameHeader, type PregamePhase, type PregamePhaseStatus } from "./PregameHeader";
import { PregameMapResult } from "./PregameMapResult";
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

/**
 * Unified pre-game room: one screen for the whole pre-game loop, which runs
 * once per map of the series —
 *
 *   map veto (this round's map) -> hero bans (for that map) -> the map is
 *   played and both captains report it -> that result opens the next map
 *
 * — until the series is decided. Both pick-ban kinds run on the same generic
 * `PickBanSession` engine, so one room renders either with the same
 * `PickBanGrid`/`PickBanStepTimeline`, and the backend keeps the loop honest:
 * a map round is only appended once the previous map's result is confirmed
 * (`pick_ban_session.advance_to_next_round`), and a hero round only once its
 * map is picked (`pick_ban_session.sync_hero_rounds`).
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
  // Either signal refetches BOTH: the two sessions are two phases of one loop,
  // so a map pick opens a hero round and a confirmed result opens a map round
  // — the state that changed is rarely only the one that was acted on.
  const invalidateRoom = () => {
    void queryClient.invalidateQueries({ queryKey: mapKey });
    void queryClient.invalidateQueries({ queryKey: heroKey });
  };
  useRealtimeTopic(`encounter:${encounterId}:map-veto`, invalidateRoom);
  useRealtimeTopic(`encounter:${encounterId}:pick-ban:hero`, invalidateRoom);

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
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
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
    !(readiness.home && readiness.away) &&
    (["map", "hero"] as PickBanKind[]).some((kind) => applicable(kind) && statesByKind[kind].reason === "not_ready");

  // ── where the loop stands ────────────────────────────────────────────────
  //
  // The maps this series has settled so far, in play order: index + 1 is the
  // round. The FIRST one still merely `picked` (not `played`) is the map whose
  // result the loop is waiting on -- `map_report.submit_map_report` flips it to
  // `played` the moment both captains agree, and that is what opens the next
  // map's bans.
  const seriesMaps = pickedItemsInOrder(mapState.pool);
  const pendingIndex = seriesMaps.findIndex((entry) => entry.status === "picked");
  const pendingMap = pendingIndex === -1 ? null : seriesMaps[pendingIndex];
  const pendingRound = pendingIndex === -1 ? null : pendingIndex + 1;
  const mapPhaseOpen = mapApplies && !(mapState.session != null && mapState.is_complete);
  // A hero round counts as settled only when it is the round of the map now
  // awaiting its result: a stale `is_complete` from the PREVIOUS round would
  // otherwise skip this map's bans in the window between its pick and the
  // server appending the round (`pick_ban_session.sync_hero_rounds`, on the
  // next read). With no map phase at all there is no round to align with, so
  // plain completeness is the whole answer.
  const heroRound = highestPoolRound(heroState.pool);
  const heroPhaseOpen =
    heroApplies &&
    !(
      heroState.session != null &&
      heroState.is_complete &&
      (pendingRound == null || (heroRound ?? 0) >= pendingRound)
    );

  const phase: PregamePhase = mapPhaseOpen
    ? "map"
    : heroPhaseOpen
      ? "hero"
      : pendingMap != null
        ? "report"
        : "done";
  // Which map of the series the room is on. During the map phase that is the
  // round being vetoed (one past the settled ones); afterwards it is the round
  // whose map is waiting to be played.
  const round = pendingRound ?? (mapApplies ? seriesMaps.length + 1 : null);
  const phases: PregamePhaseStatus[] = [
    ...(mapApplies ? [{ phase: "map" as const, done: !mapPhaseOpen }] : []),
    ...(heroApplies ? [{ phase: "hero" as const, done: !mapPhaseOpen && !heroPhaseOpen }] : []),
    ...(mapApplies ? [{ phase: "report" as const, done: phase === "done" }] : []),
  ];
  const header = (
    <PregameHeader
      encounter={encounter}
      session={statesByKind[phase === "hero" ? "hero" : "map"].session}
      activePhase={phase}
      phases={phases}
      round={round}
    />
  );

  if (waitingOnReadiness) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
          <Skeleton className="h-72 w-full rounded-xl" aria-hidden />
          <Card>
            <CardContent className="flex flex-col gap-4 p-5">
              {header}
              <Skeleton className="h-56 w-full rounded-lg" aria-hidden />
            </CardContent>
          </Card>
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

  if (phase === "report" && pendingMap != null && pendingRound != null) {
    return (
      <div className="flex flex-col gap-4">
        <PregameMapResult
          encounterId={encounterId}
          mapId={pendingMap.item_id}
          mapName={mapsById[pendingMap.item_id]?.name ?? t("map.itemNumber", { id: pendingMap.item_id })}
          round={pendingRound}
          viewerSide={mapState.viewer_side}
          homeName={encounter.home_team?.name ?? t("side.home")}
          awayName={encounter.away_team?.name ?? t("side.away")}
          reports={(mapState.map_reports ?? []).filter((report) => report.map_id === pendingMap.item_id)}
          header={header}
          invalidateKeys={[mapKey, heroKey, ["encounter-detail", encounterId]]}
        />
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-5 p-5">
            {header}
            <section className="flex flex-col gap-2 rounded-xl border border-[color:var(--aqt-border)] p-4">
              <h2 className="font-onest text-lg font-semibold">{t("seriesDone.title")}</h2>
              <p className="text-sm leading-relaxed text-[color:var(--aqt-fg-muted)]">{t("seriesDone.hint")}</p>
              <div className="mt-1">
                <Button variant="outline" asChild>
                  <Link href={`/encounters/${encounterId}`}>
                    <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                    {t("back")}
                  </Link>
                </Button>
              </div>
            </section>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeKind: PickBanKind = phase === "hero" ? "hero" : "map";
  const activeState = statesByKind[activeKind];

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
        header={header}
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
  header,
}: {
  kind: PickBanKind;
  encounterId: number;
  encounter: Encounter;
  state: PickBanState;
  session: NonNullable<PickBanState["session"]>;
  queryKey: unknown[];
  itemsById: Record<number, PickBanItemLike | undefined>;
  isAdmin: boolean;
  header: React.ReactNode;
}) {
  const t = useTranslations("pickBan.room");
  const queryClient = useQueryClient();

  const [pickedItemId, setSelectedItemId] = useState<number | null>(null);

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
          session={session}
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
            header={header}
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
