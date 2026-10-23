"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CircleX, Play } from "lucide-react";

import { useTurnAlert } from "@/app/balancer/mix/_hooks/useTurnAlert";
import { playerLabel } from "@/app/balancer/mix/pickup-lineup";
import { DraftBoard, type DraftOwner } from "@/components/draft/DraftBoard";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAuthProfile } from "@/hooks/useAuthProfile";
import { useDraftBoardQuery, useDraftMutations } from "@/hooks/useDraftData";
import { computeGating } from "@/lib/draft/logic";
import { notify } from "@/lib/notify";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";
import type { CustomGamePlayer } from "@/services/custom-game.service";
import type { DraftBoard as DraftSnapshot, DraftTeam } from "@/types/draft.types";

const NONE = "none";

/**
 * A lobby's captain draft (spec §9.3, §7.5 A2/D1): the host strip -- captains, Start draft, a waiting player for a
 * draft short of a role, Cancel -- over the shared draft board. The captain on the clock gets the in-browser alert.
 */
export function MixDraftPanel({
  sessionId,
  owner,
  canHost,
  waiting,
  replacing,
  adding,
  onReplaceCaptain,
  onAddPlayer,
}: Readonly<{
  sessionId: number;
  owner: DraftOwner;
  canHost: boolean;
  /** Present pool players no lobby seats: who a host may add to a draft short of a role, before the start too. */
  waiting: CustomGamePlayer[];
  replacing: boolean;
  adding: boolean;
  onReplaceCaptain: (teamId: number, playerId: number) => void;
  onAddPlayer: (workspaceMemberId: number) => void;
}>) {
  const t = useTranslations("mixes.draft");
  const board = useDraftBoardQuery(sessionId).data ?? null;
  const mutations = useDraftMutations(tournamentQueryKeys.draftSessionBoard(sessionId));
  const { user } = useAuthProfile();
  const [cancelOpen, setCancelOpen] = useState(false);
  const myTurn =
    board != null &&
    computeGating(board, (user?.linkedPlayers ?? []).map((player) => player.playerId), user?.id ?? null, false)
      .isMyPick;
  useTurnAlert(myTurn, t("yourPickTitle"));
  const setup = board != null && (board.session.status === "setup" || board.session.status === "ready");
  const run = (action: "start" | "cancel") =>
    mutations.lifecycle.mutate(
      { sessionId, action },
      {
        onSuccess: () => notify.success(t(action === "start" ? "started" : "cancelled")),
        onError: (error) => notify.apiError(error),
      },
    );

  return (
    <div className="flex flex-col gap-3">
      {canHost && board != null ? (
        <Card variant="flat" className="flex flex-wrap items-center gap-2 px-4 py-3">
          {board.teams.map((team) => (
            <CaptainSelect
              key={team.id}
              board={board}
              team={team}
              label={t("captainOf", { team: team.name })}
              setup={setup}
              disabled={replacing}
              onChange={(playerId) => onReplaceCaptain(team.id, playerId)}
            />
          ))}
          {waiting.length > 0 ? (
            <Select
              value={NONE}
              disabled={adding}
              onValueChange={(value) => value !== NONE && onAddPlayer(Number(value))}
            >
              <SelectTrigger aria-label={t("addPlayer")} size="sm" className="w-48 bg-background/50">
                <SelectValue placeholder={t("addPlayer")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("addPlayer")}</SelectItem>
                {waiting.map((row) => (
                  <SelectItem key={row.workspace_member_id} value={String(row.workspace_member_id)}>
                    {playerLabel(row)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {setup ? (
            <Button type="button" disabled={mutations.lifecycle.isPending} onClick={() => run("start")}>
              {mutations.lifecycle.isPending ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <Play className="mr-1.5 size-3.5" aria-hidden="true" />
              )}
              {t("startDraft")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={mutations.lifecycle.isPending}
            onClick={() => setCancelOpen(true)}
          >
            <CircleX className="mr-1.5 size-3.5" aria-hidden="true" />
            {t("cancelDraft")}
          </Button>
          <ConfirmDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            intent={{
              title: t("cancelTitle"),
              description: t("cancelDescription"),
              confirmLabel: t("cancelConfirm"),
              tone: "danger",
            }}
            pending={mutations.lifecycle.isPending}
            onConfirm={() => {
              setCancelOpen(false);
              run("cancel");
            }}
          />
        </Card>
      ) : null}
      {/* Bottom padding clears the board's fixed pick bar. */}
      <div className="pb-56 sm:pb-28">
        <DraftBoard sessionId={sessionId} owner={owner} />
      </div>
    </div>
  );
}

/**
 * One team's captain: before the start any pool player, during the draft a player already on the team. The current
 * one is the seat the board crowns -- the team's current captain, a replacement included (U2).
 */
function CaptainSelect({
  board,
  team,
  label,
  setup,
  disabled,
  onChange,
}: Readonly<{
  board: DraftSnapshot;
  team: DraftTeam;
  label: string;
  setup: boolean;
  disabled: boolean;
  onChange: (playerId: number) => void;
}>) {
  const current = board.players.find((player) => player.is_captain && player.drafted_by_team_id === team.id);
  const options = setup ? board.players : board.players.filter((player) => player.drafted_by_team_id === team.id);
  return (
    <Select
      value={current ? String(current.id) : NONE}
      disabled={disabled}
      onValueChange={(value) => value !== NONE && onChange(Number(value))}
    >
      <SelectTrigger aria-label={label} title={label} size="sm" className="w-48 bg-background/50">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {current ? null : <SelectItem value={NONE}>{label}</SelectItem>}
        {options.map((player) => (
          <SelectItem key={player.id} value={String(player.id)}>
            {player.identity?.handle ?? player.player_name ?? `#${player.id}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
