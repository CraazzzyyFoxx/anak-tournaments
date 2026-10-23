"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, UserX } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDisciplineMetadata } from "@/hooks/useDisciplineMetadata";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import pickBanService, {
  type PickBanActionInput,
  type PickBanSubmitInput
} from "@/services/pickBan.service";
import type {
  PickBanAction,
  PickBanKind,
  PickBanState,
  PickBanSubmissionItem
} from "@/types/tournament.types";

import {
  DRAFT_SAVE_DELAY_MS,
  eligibleItemIds,
  isSessionActive,
  lastRevealedBlindStep,
  memberName,
  pickBanReserveMap,
  pickBanSeats,
  seatName,
  stepSubmissions,
  viewerSubmission,
  type PickBanSeat
} from "@/components/pick-ban/pick-ban-model";
import { PickBanCommandBar } from "@/components/pick-ban/PickBanCommandBar";
import { PickBanDraftTray } from "@/components/pick-ban/PickBanDraftTray";
import { PickBanGrid, type PickBanItemLike } from "@/components/pick-ban/PickBanGrid";
import { PickBanRevealPanel } from "@/components/pick-ban/PickBanRevealPanel";
import { PickBanAssignBoard, PickBanMemberChooser } from "@/components/pick-ban/PickBanMemberTurn";
import { PickBanStepTimeline } from "@/components/pick-ban/PickBanStepTimeline";
import { PickBanTargetBoard } from "@/components/pick-ban/PickBanTargetBoard";
import { PickBanUndoControl } from "@/components/pick-ban/PickBanUndoControl";
import { PickBanSideAssignment, PickBanSideChoice } from "@/components/pick-ban/PickBanSideChoice";
import { useSideLabel } from "@/components/pick-ban/useSideLabel";
import { ElectOpenerDialog } from "@/components/pick-ban/ElectOpenerDialog";

/**
 * What the board lends the room's admin panel: the tile the organizer has
 * selected here, and the cleanup only this board can do (its selection and
 * its unsaved draft are local state).
 */
export interface PickBanAdminSlot {
  kind: PickBanKind;
  selectedItemId: number | null;
  selectedItemName: string | null;
  /**
   * The blind draft being built out of THIS pool for an absent captain, or
   * null when no blind step is open to an organizer. The board owns the tile
   * clicks that fill it; the panel owns whose draft it is and when it is sent.
   */
  blind: {
    items: PickBanSubmissionItem[];
    /** The opponent player the next tile click lands on, on a targeted step. */
    targetPlayerId: number | null;
    setTargetPlayerId: (playerId: number | null) => void;
    removeAt: (index: number) => void;
    /** Drop the whole draft — the panel does this when the side changes. */
    clear: () => void;
  } | null;
  onMutated: () => void;
}

/** What the board reads off its room: the game, its two seats. A mix room has no Encounter read (D77). */
export type PickBanBoardEncounter = { workspace_id: number; discipline: string; teams: readonly PickBanSeat[] };

/** The board for whichever pick-ban kind is on the clock: timeline, pool, command bar. */
export function PickBanPanel({
  kind,
  encounterId,
  encounter,
  state,
  session,
  queryKey,
  itemsById,
  isAdmin,
  adminPanel,
  header,
  previousMatchId
}: Readonly<{
  kind: PickBanKind;
  encounterId: number;
  encounter: PickBanBoardEncounter;
  state: PickBanState;
  session: NonNullable<PickBanState["session"]>;
  queryKey: unknown[];
  itemsById: Record<number, PickBanItemLike | undefined>;
  isAdmin: boolean;
  /**
   * The organizer's panel, rendered under the pool. The room owns it (one per
   * screen, across every phase) and only borrows this board's selection.
   */
  adminPanel?: (slot: PickBanAdminSlot) => React.ReactNode;
  header: React.ReactNode;
  /** The previous map's parsed match, for a per-player ban's "last played" hints; null when there is none. */
  previousMatchId: number | null;
}>) {
  const t = useTranslations("pickBan.room");
  const queryClient = useQueryClient();
  // The room's own game: its role dictionary names the targets' roles, its declared classes order the pool filter.
  const metadata = useDisciplineMetadata(encounter.workspace_id, encounter.discipline);

  const step = state.current_step;
  const viewerTeamId = state.viewer_team_id;
  const seats = pickBanSeats(encounter.teams);
  const opponentTeamId =
    viewerTeamId == null ? null : (seats.find((seat) => seat.id !== viewerTeamId)?.id ?? null);
  // A mix's hero picks (spec §11.6): a member step is answered for ONE player, an assignment by a captain at once.
  const memberStep = step?.member != null;
  const assignStep = step?.action === "assign";
  // Whom this viewer may pick for: themselves, as captain their teammates still owing, as a host anyone still owing.
  const choosableMembers = !memberStep
    ? []
    : isAdmin
      ? [
          ...state.viewer_member_ids,
          ...state.acting_member_ids.filter((id) => !state.viewer_member_ids.includes(id))
        ]
      : state.viewer_can_act
        ? state.viewer_member_ids
        : [];
  const [chosenMember, setChosenMember] = useState<number | null>(null);
  const actingMemberId =
    chosenMember != null && choosableMembers.includes(chosenMember) ? chosenMember : (choosableMembers[0] ?? null);
  // On a member step the answer is that player's own: a teammate's lock never closes this pick.
  const submission = viewerSubmission(state, actingMemberId);
  const serverDraft = submission?.items ?? [];
  const draftLocked = submission != null && submission.state !== "draft";

  const [pickedItemId, setSelectedItemId] = useState<number | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null);
  /**
   * The draft an organizer is building out of this pool for an absent captain.
   * It lives here, not in the admin panel, because the clicks that fill it are
   * this board's — the panel only names the side it is for and sends it.
   */
  const [adminDraft, setAdminDraft] = useState<PickBanSubmissionItem[]>([]);
  const [adminTargetId, setAdminTargetId] = useState<number | null>(null);
  /**
   * The viewer's own edits since the last server read, keyed by the step and
   * attempt they were made on — so a reveal, a new round or a dispute
   * (attempt + 1, prefilled by the server) drops them without an effect and
   * without ever showing one step's draft on another.
   */
  const stepKey = `${state.current_step_index ?? -1}:${submission?.attempt ?? 0}`;
  const [localDraft, setLocalDraft] = useState<{
    key: string;
    items: PickBanSubmissionItem[];
  } | null>(null);
  const draftItems = localDraft?.key === stepKey ? localDraft.items : serverDraft;
  // The Lock trusts `draft_issues`, and those judge the SAVED draft — so it
  // waits until the local edits are that draft.
  const draftKey = (items: PickBanSubmissionItem[]) =>
    items.map((item) => `${item.item_id}:${item.target_player_id ?? ""}`).join(",");
  const draftDirty = draftKey(draftItems) !== draftKey(serverDraft);

  const selectedItemId =
    pickedItemId != null &&
    state.pool.some((entry) => entry.item_id === pickedItemId && entry.status === "available") &&
    // A member pick is the chosen player's: switching to one who may not take the hero (Fearless) drops it.
    (!memberStep || (state.member_eligible?.[String(actingMemberId)] ?? []).includes(pickedItemId))
      ? pickedItemId
      : null;

  // A side step chooses an index into `state.sides`, never a catalog item: its own state, never filtered through
  // the pool. It belongs to one turn — this step as it was (re)opened — and is DISCARDED the moment the turn
  // changes, so an undo back to the same step index starts with no side chosen instead of resurrecting one.
  const isSideStep = step?.action === "side_pick";
  const sideKey = `${session.id}:${stepKey}:${session.current_step_started_at ?? ""}`;
  const [pickedSide, setPickedSide] = useState<{ key: string; index: number | null }>({
    key: sideKey,
    index: null
  });
  if (pickedSide.key !== sideKey) setPickedSide({ key: sideKey, index: null });
  const selectedSide = isSideStep && pickedSide.key === sideKey ? pickedSide.index : null;
  const sideLabelOf = useSideLabel();
  const sideLabel = (code: string) => sideLabelOf(encounter.discipline, code);
  const sideLabels = state.sides.map(sideLabel);
  const sideHintId = useId();

  const actionMutation = useMutation({
    mutationFn: (input: PickBanActionInput) =>
      pickBanService.performPickBanAction(kind, encounterId, input),
    onSuccess: (next) => {
      setSelectedItemId(null);
      setPickedSide((current) => ({ ...current, index: null }));
      setSelectedTargetId(null);
      queryClient.setQueryData(queryKey, next);
    },
    onError: (error) => notify.apiError(error, { title: t("captain.actionFailed") }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey })
  });

  // A host picking for a player they are not: the organizer route, which acts for any seat (spec §11.6 R4-9).
  const hostPickMutation = useMutation({
    mutationFn: (input: { encounter_team_id: number; item_id: number; member_id: number }) =>
      adminService.adminPickBanAct(encounterId, { kind, action: "pick", ...input }),
    onSuccess: () => setSelectedItemId(null),
    onError: (error) => notify.apiError(error, { title: t("captain.actionFailed") }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey })
  });

  const submitMutation = useMutation({
    mutationFn: (input: PickBanSubmitInput) => pickBanService.submitDraft(kind, encounterId, input),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error) => {
      // The optimistic tray is wrong now; the server's answer is the truth.
      setLocalDraft(null);
      notify.apiError(error, { title: t("draft.saveFailed") });
    }
  });
  const submitDraft = submitMutation.mutate;

  const disputeMutation = useMutation({
    mutationFn: () => pickBanService.disputeStep(kind, encounterId),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error) => notify.apiError(error, { title: t("dispute.failed") }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey })
  });

  // Debounced autosave: a blind draft is built by clicking five tiles in a row,
  // and each click is not worth a round trip. The lock is sent separately and
  // immediately — it is the only write that has a deadline behind it.
  const savedRef = useRef<string | null>(null);
  useEffect(() => {
    if (localDraft == null || localDraft.key !== stepKey) return;
    const payload = JSON.stringify(localDraft.items);
    if (savedRef.current === `${stepKey}|${payload}`) return;
    const timer = setTimeout(() => {
      savedRef.current = `${stepKey}|${payload}`;
      submitDraft({ items: localDraft.items, lock: false });
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [localDraft, stepKey, submitDraft]);

  const teamName = (teamId: number) => seatName(seats, teamId);

  const targets = state.targets;
  const targetRoster =
    targets != null && opponentTeamId != null ? (targets[opponentTeamId] ?? []) : [];
  const targetName = (playerId: number) =>
    Object.values(targets ?? {})
      .flat()
      .find((player) => player.player_id === playerId)?.name ?? null;

  const isBlindStep = step?.blind === true;
  // A member step picks for the chosen player; an assignment is answered by submit, never by an act (spec §11.6 R4-1).
  const captainAction: PickBanAction | null = memberStep
    ? actingMemberId != null
      ? "pick"
      : null
    : !isBlindStep &&
        state.viewer_can_act &&
        state.allowed_actions.length > 0 &&
        state.allowed_actions[0] !== "assign"
      ? state.allowed_actions[0]
      : null;
  // An organizer standing in for an absent captain fills the blind draft out of
  // this same pool — unless they ARE the captain on the clock, whose own draft
  // keeps the clicks.
  const adminDrafting = isAdmin && isBlindStep && !state.viewer_can_act;
  const canSelect =
    isSessionActive(session) &&
    !assignStep &&
    !state.is_complete &&
    ((state.viewer_can_act && !draftLocked) || (isAdmin && !isBlindStep) || adminDrafting);
  const selectedItemName =
    selectedItemId != null
      ? (itemsById[selectedItemId]?.name ?? t(`${kind}.itemNumber`, { id: selectedItemId }))
      : null;

  const draftItemIds = new Set(
    (adminDrafting ? adminDraft : draftItems).map((item) => item.item_id)
  );
  const eligibleIds = memberStep
    ? actingMemberId != null
      ? new Set(state.member_eligible?.[String(actingMemberId)] ?? [])
      : null
    : eligibleItemIds(state.eligible, selectedTargetId);
  const assignedByPlayer: Record<number, number | undefined> = {};
  for (const item of draftItems) {
    if (item.target_player_id != null) assignedByPlayer[item.target_player_id] = item.item_id;
  }

  /**
   * One tile click on a blind step against a draft: add the item, or take it
   * back out. On a per-player step the click lands on the given player, and a
   * second hero for that player replaces the first — `one_per_target` makes
   * two of them illegal anyway, and silently refusing the click would read as
   * a broken tile. `null` back means the step names a player and none is
   * chosen yet — the caller says so, this only computes.
   */
  const toggleBlindItem = (
    items: PickBanSubmissionItem[],
    itemId: number,
    targetPlayerId: number | null
  ): PickBanSubmissionItem[] | null => {
    if (step == null) return items;
    const targeted = step.target != null;
    const existing = items.findIndex(
      (item) =>
        item.item_id === itemId &&
        (!targeted || item.target_player_id === targetPlayerId || targetPlayerId == null)
    );
    if (existing >= 0) return items.filter((_, index) => index !== existing);
    if (targeted && targetPlayerId == null) return null;
    const room = targeted
      ? items.filter((item) => item.target_player_id !== targetPlayerId)
      : items;
    if (room.length >= step.count) return items;
    return [...room, { item_id: itemId, target_player_id: targeted ? targetPlayerId : null }];
  };

  const toggleDraftItem = (itemId: number) => {
    if (step == null || draftLocked) return;
    const next = toggleBlindItem(draftItems, itemId, selectedTargetId);
    if (next == null) {
      notify.info(t("target.selectFirst"));
      return;
    }
    setLocalDraft({ key: stepKey, items: next });
  };

  /** The same click, for the side an organizer is standing in for. */
  const toggleAdminDraftItem = (itemId: number) => {
    const next = toggleBlindItem(adminDraft, itemId, adminTargetId);
    if (next == null) {
      notify.info(t("target.selectFirst"));
      return;
    }
    setAdminDraft(next);
  };

  const revealedStep = lastRevealedBlindStep(state.sequence, state.submissions);

  // The backend enforces who may elect (pending_chooser_team_id); this only
  // gates whether the losing captain's own client shows the modal at all.
  const showElectOpener =
    session.awaiting_choice &&
    viewerTeamId != null &&
    viewerTeamId === session.pending_chooser_team_id;
  // ...and everyone ELSE has to be told why the room stopped. The round the
  // choice is holding does not exist yet, so a spectator, the winning captain
  // and an organizer all saw a finished round with nothing to click and no
  // reason given — the exact shape of a hung room.
  const pendingOpenerTeamId = session.awaiting_choice ? session.pending_chooser_team_id : null;

  return (
    <>
      {pendingOpenerTeamId != null ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-[color:var(--aqt-amber)]/45 bg-[color:var(--aqt-card-2)]/40 p-3 text-sm">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--aqt-amber)]" aria-hidden />
          <p className="text-[color:var(--aqt-fg-muted)]">
            {t("electOpener.waiting", { team: teamName(pendingOpenerTeamId) })}
          </p>
        </div>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        {/* Stretched to the row so the per-player board can stick inside it for
            the whole height of the pool beside it: the captain alternates
            "who" (here) and "which hero" (the grid) five times in a row. */}
        <div className="flex flex-col gap-4 lg:self-stretch">
          <PickBanStepTimeline
            kind={kind}
            sequence={state.sequence}
            submissions={state.submissions}
            currentStepIndex={state.current_step_index}
            isComplete={state.is_complete}
            currentRound={state.current_round}
            itemsById={itemsById}
            sideLabels={sideLabels}
            teamName={teamName}
            memberName={(memberId) => memberName(state.members, memberId)}
            session={session}
          />
          <PickBanSideAssignment
            startingSides={state.starting_sides}
            position={state.current_round}
            seats={seats}
            sideLabel={sideLabel}
          />
          {memberStep && choosableMembers.length > 1 ? (
            <PickBanMemberChooser
              members={choosableMembers.map((id) => ({ id, name: memberName(state.members, id) }))}
              value={actingMemberId}
              onChange={setChosenMember}
            />
          ) : null}
          {step?.target != null && opponentTeamId != null ? (
            targetRoster.length > 0 ? (
              <div className="lg:sticky lg:top-[var(--aqt-sticky-top)]">
                <PickBanTargetBoard
                  targets={targetRoster}
                  discipline={encounter.discipline}
                  ontology={metadata.data ?? null}
                  previousMatchId={previousMatchId}
                  selectedPlayerId={selectedTargetId}
                  assignedByPlayer={assignedByPlayer}
                  itemsById={itemsById}
                  onSelect={(playerId) =>
                    setSelectedTargetId((current) => (current === playerId ? null : playerId))
                  }
                  teamName={teamName(opponentTeamId)}
                  disabled={!canSelect}
                />
              </div>
            ) : (
              // Without the opponent's roster nobody can be named, so the whole
              // pool is ineligible — say why instead of leaving a grey grid.
              <div
                data-pick-ban-no-roster
                className="flex items-start gap-2 rounded-xl border border-[color:var(--aqt-amber)]/45 bg-[color:var(--aqt-card-2)]/40 p-3 text-sm"
              >
                <UserX
                  className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--aqt-amber)]"
                  aria-hidden
                />
                <p className="text-[color:var(--aqt-fg-muted)]">
                  {t("target.noRoster", { team: teamName(opponentTeamId) })}
                </p>
              </div>
            )
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          {revealedStep != null ? (
            <PickBanRevealPanel
              kind={kind}
              step={revealedStep}
              submissions={stepSubmissions(state.submissions, revealedStep.index)}
              itemsById={itemsById}
              seats={seats}
              targetName={targetName}
              dispute={state.dispute}
              disputing={disputeMutation.isPending}
              onDispute={() => disputeMutation.mutate()}
            />
          ) : null}

          {isSideStep ? (
            // No pool on a side step: the captain chooses a side, and a champion tile here would be a 400.
            <Card>
              <CardHeader className="flex flex-col gap-4 pb-3">
                {header}
                <div className="border-t border-[color:var(--aqt-border)] pt-4">
                  <CardTitle id={sideHintId} className="text-base">
                    {t("captain.chooseSideHint")}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <PickBanSideChoice
                  labelledBy={sideHintId}
                  labels={sideLabels}
                  value={selectedSide}
                  size="lg"
                  disabled={captainAction !== "side_pick" || actionMutation.isPending}
                  onChange={(index) =>
                    setPickedSide({ key: sideKey, index: selectedSide === index ? null : index })
                  }
                />
              </CardContent>
            </Card>
          ) : assignStep ? (
            <PickBanAssignBoard
              kind={kind}
              encounterId={encounterId}
              state={state}
              itemsById={itemsById}
              isAdmin={isAdmin}
              queryKey={queryKey}
              teamName={teamName}
              header={header}
            />
          ) : (
            <PickBanGrid
              kind={kind}
              pool={state.pool}
              itemsById={itemsById}
              selectedItemId={selectedItemId}
              canSelect={canSelect}
              currentRound={state.current_round}
              slotReserves={pickBanReserveMap(session)}
              eligibleIds={eligibleIds}
              draftItemIds={draftItemIds}
              onSelect={(itemId) => {
                if (isBlindStep) {
                  if (adminDrafting) toggleAdminDraftItem(itemId);
                  else toggleDraftItem(itemId);
                  return;
                }
                setSelectedItemId((current) => (current === itemId ? null : itemId));
              }}
              seats={seats}
              header={header}
              characterClasses={metadata.data?.discipline.character_classes}
            />
          )}

          {/* Under the grid, above the admin panel: the correction path a
              captain reaches for belongs next to the pool they misclicked, and
              it is the captains' own — an organizer's blunt reset is separate. */}
          <PickBanUndoControl
            kind={kind}
            encounterId={encounterId}
            undo={state.undo}
            viewerTeamId={viewerTeamId}
            itemsById={itemsById}
            sideLabels={sideLabels}
            seats={seats}
            invalidateKeys={[queryKey]}
          />

          {adminPanel?.({
            kind,
            // The organizer's side choice lives in the admin row; a tile picked on an earlier step is not it.
            selectedItemId: isSideStep ? null : selectedItemId,
            selectedItemName: isSideStep ? null : selectedItemName,
            blind: adminDrafting
              ? {
                  items: adminDraft,
                  targetPlayerId: adminTargetId,
                  setTargetPlayerId: setAdminTargetId,
                  removeAt: (index) =>
                    setAdminDraft((items) => items.filter((_, position) => position !== index)),
                  clear: () => setAdminDraft([])
                }
              : null,
            onMutated: () => {
              setSelectedItemId(null);
              setLocalDraft(null);
              setAdminDraft([]);
              void queryClient.invalidateQueries({ queryKey });
            }
          })}
        </div>
      </div>

      {isSessionActive(session) ? (
        <PickBanCommandBar
          state={state}
          teamName={teamName}
          captainAction={state.is_complete ? null : captainAction}
          draft={
            isBlindStep && step != null && viewerTeamId != null ? (
              <PickBanDraftTray
                kind={kind}
                step={step}
                items={draftItems}
                locked={draftLocked}
                dirty={draftDirty}
                issues={state.draft_issues}
                locking={submitMutation.isPending}
                itemsById={itemsById}
                targetName={targetName}
                opponentTeamId={opponentTeamId}
                opponentProgress={
                  opponentTeamId != null ? state.step_progress?.[opponentTeamId] : undefined
                }
                opponentName={opponentTeamId != null ? teamName(opponentTeamId) : ""}
                onRemove={(index) =>
                  setLocalDraft({
                    key: stepKey,
                    items: draftItems.filter((_, position) => position !== index)
                  })
                }
                onLock={() => submitDraft({ items: draftItems, lock: true })}
              />
            ) : null
          }
          draftOpen={isBlindStep && state.viewer_can_act && !draftLocked && !state.is_complete}
          kind={kind}
          selectedItemId={isSideStep ? selectedSide : selectedItemId}
          selectedItemName={
            isSideStep
              ? selectedSide != null
                ? (sideLabels[selectedSide] ?? `#${selectedSide}`)
                : null
              : selectedItemName
          }
          selectedItem={!isSideStep && selectedItemId != null ? itemsById[selectedItemId] : undefined}
          pending={actionMutation.isPending || hostPickMutation.isPending}
          forMember={memberStep && actingMemberId != null ? memberName(state.members, actingMemberId) : null}
          onConfirm={(itemId) => {
            if (captainAction == null) return;
            if (memberStep && actingMemberId != null) {
              // Their own or a teammate's pick goes by the captain route; anyone else's is a host's, for that seat.
              if (state.viewer_can_act && state.viewer_member_ids.includes(actingMemberId)) {
                actionMutation.mutate({ item_id: itemId, action: "pick", member_id: actingMemberId });
                return;
              }
              const seat = state.members.find((member) => member.id === actingMemberId);
              if (seat != null) {
                hostPickMutation.mutate({
                  encounter_team_id: seat.encounter_team_id,
                  item_id: itemId,
                  member_id: actingMemberId
                });
              }
              return;
            }
            actionMutation.mutate({
              item_id: itemId,
              action: captainAction,
              ...(step?.target != null ? { target_player_id: selectedTargetId } : {})
            });
          }}
          onCancel={() =>
            isSideStep
              ? setPickedSide((current) => ({ ...current, index: null }))
              : setSelectedItemId(null)
          }
        />
      ) : null}

      <ElectOpenerDialog
        kind={kind}
        encounterId={encounterId}
        open={showElectOpener}
        seats={seats}
        queryKey={queryKey}
      />
    </>
  );
}
