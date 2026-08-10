"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Loader2, Shield, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { notify } from "@/lib/notify";
import pickBanService, { type PickBanActionInput } from "@/services/pickBan.service";
import encounterService from "@/services/encounter.service";
import heroService from "@/services/hero.service";
import type { PickBanAction } from "@/types/tournament.types";

import { PICK_BAN_UNAVAILABLE_COPY, isSessionActive, type PickBanSide } from "@/components/pick-ban/pick-ban-model";
import { PickBanGrid, type PickBanItemLike } from "@/components/pick-ban/PickBanGrid";
import { PickBanStepTimeline } from "@/components/pick-ban/PickBanStepTimeline";
import { ElectOpenerDialog } from "@/components/pick-ban/ElectOpenerDialog";
import { HeroBanHero } from "./HeroBanHero";

interface HeroBanRoomProps {
  encounterId: number;
}

const UNAVAILABLE_ICON: Record<string, React.ReactNode> = {
  teams: <ShieldAlert className="h-6 w-6 text-[color:var(--aqt-teal)]" aria-hidden />,
  unconfigured: <ShieldAlert className="h-6 w-6 text-[color:var(--aqt-amber)]" aria-hidden />,
  misconfigured: <ShieldAlert className="h-6 w-6 text-[color:var(--aqt-amber)]" aria-hidden />,
};

export function HeroBanRoom({ encounterId }: HeroBanRoomProps) {
  const t = useTranslations("pickBan.room");
  const queryClient = useQueryClient();

  const stateQueryKey = ["encounter-hero-pool-state", encounterId];
  const stateQuery = useQuery({
    queryKey: stateQueryKey,
    queryFn: () => pickBanService.getHeroPoolState(encounterId),
    enabled: Number.isFinite(encounterId) && encounterId > 0,
  });
  const encounterQuery = useQuery({
    queryKey: ["encounter-detail", encounterId],
    queryFn: () => encounterService.getEncounter(encounterId),
    enabled: Number.isFinite(encounterId) && encounterId > 0,
  });
  const heroesQuery = useQuery({
    queryKey: ["heroes-all"],
    queryFn: () => heroService.getAll({ perPage: -1 }),
    staleTime: 5 * 60 * 1000,
  });

  // Same thin-signal contract as the map-veto room: the hub only says
  // "something changed", the authoritative state is always refetched.
  useRealtimeTopic(`encounter:${encounterId}:pick-ban:hero`, () => {
    void queryClient.invalidateQueries({ queryKey: stateQueryKey });
  });

  const state = stateQuery.data ?? null;
  const encounter = encounterQuery.data ?? null;

  const heroesById = useMemo(() => {
    const byId: Record<number, PickBanItemLike | undefined> = {};
    for (const hero of heroesQuery.data?.results ?? []) byId[hero.id] = hero;
    return byId;
  }, [heroesQuery.data]);

  const [pickedItemId, setSelectedItemId] = useState<number | null>(null);
  const selectedItemId =
    pickedItemId != null && state?.pool.some((entry) => entry.item_id === pickedItemId && entry.status === "available")
      ? pickedItemId
      : null;

  const actionMutation = useMutation({
    mutationFn: (input: PickBanActionInput) => pickBanService.performHeroVeto(encounterId, input),
    onSuccess: () => setSelectedItemId(null),
    onError: (error) => notify.apiError(error, { title: t("captain.actionFailed") }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: stateQueryKey }),
  });

  if (stateQuery.isPending || encounterQuery.isPending) {
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

  if (stateQuery.isError || state === null || !encounter) {
    return (
      <EmptyRoomCard
        icon={<ShieldAlert className="h-6 w-6 text-[color:var(--aqt-amber)]" aria-hidden />}
        title={t("loadError")}
        action={
          <Button
            onClick={() => {
              void stateQuery.refetch();
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

  if (!state.session) {
    const copy = PICK_BAN_UNAVAILABLE_COPY[state.reason ?? "not_configured"];
    return (
      <EmptyRoomCard
        icon={UNAVAILABLE_ICON[copy.icon]}
        title={t(copy.titleKey)}
        hint={t(copy.hintKey)}
        encounterId={encounterId}
      />
    );
  }

  const session = state.session;
  const sideName = (side: PickBanSide) =>
    side === "home" ? (encounter.home_team?.name ?? t("side.home")) : (encounter.away_team?.name ?? t("side.away"));

  const turnBanner = state.is_complete
    ? t("completedBanner")
    : state.expected_action === "decider"
      ? t("deciderResolving")
      : state.turn_side && state.expected_action
        ? t("turn", { side: sideName(state.turn_side), action: t(`action.${state.expected_action}`) })
        : null;

  const captainAction: PickBanAction | null =
    state.viewer_can_act && state.allowed_actions.length > 0 ? state.allowed_actions[0] : null;
  const canSelect = isSessionActive(session) && !state.is_complete && captainAction !== null;
  const selectedItemName =
    selectedItemId != null ? (heroesById[selectedItemId]?.name ?? t("hero.itemNumber", { id: selectedItemId })) : null;

  // The backend enforces who may elect (pending_loser_side); this only gates
  // whether the losing captain's own client shows the modal at all.
  const showElectOpener = session.awaiting_choice && state.viewer_side === session.pending_loser_side;

  return (
    <div className="flex flex-col gap-4">
      <HeroBanHero encounter={encounter} state={state} session={session} />

      {turnBanner ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-card-2)]/50 px-4 py-2.5 text-sm font-medium"
        >
          {turnBanner}
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        <PickBanStepTimeline
          kind="hero"
          sequence={state.sequence}
          pool={state.pool}
          currentStepIndex={state.current_step_index}
          isComplete={state.is_complete}
          currentRound={state.current_round}
          itemsById={heroesById}
          sideName={sideName}
        />
        <div className="flex flex-col gap-4">
          <PickBanGrid
            kind="hero"
            pool={state.pool}
            itemsById={heroesById}
            selectedItemId={selectedItemId}
            canSelect={canSelect}
            currentRound={state.current_round}
            onSelect={(itemId) => setSelectedItemId((current) => (current === itemId ? null : itemId))}
          />

          {captainAction !== null && isSessionActive(session) && !state.is_complete ? (
            <CaptainActionBar
              action={captainAction}
              selectedItemId={selectedItemId}
              selectedItemName={selectedItemName}
              pending={actionMutation.isPending}
              onConfirm={(itemId) => actionMutation.mutate({ item_id: itemId, action: captainAction })}
              onCancel={() => setSelectedItemId(null)}
            />
          ) : null}
        </div>
      </div>

      <ElectOpenerDialog
        encounterId={encounterId}
        open={showElectOpener}
        homeName={sideName("home")}
        awayName={sideName("away")}
        queryKey={stateQueryKey}
      />
    </div>
  );
}

/** Two-step confirmation: select a hero in the grid, then confirm the action here. */
function CaptainActionBar({
  action,
  selectedItemId,
  selectedItemName,
  pending,
  onConfirm,
  onCancel,
}: {
  action: PickBanAction;
  selectedItemId: number | null;
  selectedItemName: string | null;
  pending: boolean;
  onConfirm: (itemId: number) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("pickBan.room");

  const confirmLabel =
    action === "ban"
      ? t("captain.confirmBan", { item: selectedItemName ?? "—" })
      : action === "protect"
        ? t("captain.confirmProtect", { item: selectedItemName ?? "—" })
        : t("captain.confirmPick", { item: selectedItemName ?? "—" });

  return (
    <section
      aria-label={t("captain.yourTurn")}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--aqt-teal)]/45 bg-[color:var(--aqt-teal)]/8 px-4 py-3"
    >
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--aqt-teal)]">
        {action === "ban" ? <Ban className="h-4 w-4" aria-hidden /> : null}
        {action === "protect" ? <Shield className="h-4 w-4" aria-hidden /> : null}
        {t("captain.yourTurn")}
      </span>
      <span className="text-sm text-[color:var(--aqt-fg-muted)]">{selectedItemName ?? t("captain.selectHint")}</span>
      <div className="ml-auto flex items-center gap-2">
        {selectedItemId != null ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
            {t("captain.cancel")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={action === "ban" ? "destructive" : "default"}
          disabled={selectedItemId == null || pending}
          onClick={() => {
            if (selectedItemId != null) onConfirm(selectedItemId);
          }}
        >
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          {pending ? t("captain.sending") : confirmLabel}
        </Button>
      </div>
    </section>
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
