"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Headphones, Shuffle, Users } from "lucide-react";

import { NextMapStrip } from "@/app/balancer/mix/_components/NextMapStrip";
import { StartMatchButton } from "@/app/balancer/mix/_components/StartMatchButton";
import { PickupResultControls } from "@/app/balancer/mix/PickupResultControls";
import { CAPTION_CLASS, CARD_TITLE_CLASS } from "@/app/balancer/mix/pickup-chrome";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { CatalogEntityRead } from "@/types/catalog.types";
import type {
  CustomGame,
  CustomGameLobby,
  CustomGameMatch,
  CustomGameOutcome
} from "@/services/custom-game.service";

/** Everything the match centre writes, handed down by the room (its mutations live in `usePickupMix`). */
export interface RoomMatchActions {
  onBalance: () => void;
  balancing: boolean;
  onDraft: () => void;
  drafting: boolean;
  onStartMatch: (flipOpener: boolean) => void;
  starting: boolean;
  onRecord: (outcome: CustomGameOutcome) => void;
  recording: boolean;
  onNextMapChange: (mapId: number | null) => void;
  settingNextMap: boolean;
}

/**
 * The room's centre outside the draft and the bans (spec §5): an idle lobby waiting for its teams, a formed one
 * waiting for its start (the map, who bans first), and a live one waiting for its result. A host's action for the
 * phase sits here; everyone else reads what the lobby waits for.
 */
export function RoomMatchStage({
  phase,
  game,
  lobby,
  canWrite,
  teamNames,
  awayNames,
  shortSeats,
  maps,
  mixMatches,
  voiceUrl,
  actions
}: Readonly<{
  phase: "idle" | "ready" | "live";
  game: CustomGame;
  lobby: CustomGameLobby;
  canWrite: boolean;
  /** The two lineup team names, left then right. */
  teamNames: readonly [string, string];
  /** Seated players who stepped away (the start dialog names them). */
  awayNames: readonly string[];
  /** "{count} of {need} players" while the lobby cannot fill its seats; null when it can. */
  shortSeats: string | null;
  maps: CatalogEntityRead[];
  mixMatches: CustomGameMatch[];
  /** The viewer's own team voice channel while they play here. */
  voiceUrl: string | null;
  actions: RoomMatchActions;
}>) {
  const t = useTranslations("mixes.arena.match");
  const tRoom = useTranslations("mixes.room");
  const tTeams = useTranslations("mixes.teams");
  const tLobbies = useTranslations("mixes.lobbies");
  const [reformOpen, setReformOpen] = useState<"draft" | "balance" | null>(null);
  const draftMode = game.team_formation === "draft";
  const mapName =
    lobby.next_map_id == null ? null : (maps.find((map) => map.id === lobby.next_map_id)?.name ?? null);
  // Re-forming replaces a lineup nobody recorded: that result would be lost, so the button asks first.
  const atRisk = lobby.lineup_recorded === false;
  const reform = (kind: "draft" | "balance") =>
    atRisk ? setReformOpen(kind) : kind === "draft" ? actions.onDraft() : actions.onBalance();

  const formButtons = canWrite ? (
    <div className="flex flex-wrap items-center gap-2">
      {draftMode ? (
        <Button
          type="button"
          variant={phase === "idle" ? "default" : "outline"}
          size="sm"
          disabled={actions.drafting || shortSeats != null}
          onClick={() => reform("draft")}
        >
          {actions.drafting ? <Spinner className="mr-1.5 size-3.5" /> : <Users className="mr-1.5 size-3.5" aria-hidden />}
          {phase === "idle" ? tRoom("draft") : t("draftAgain")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant={!draftMode && phase === "idle" ? "default" : "outline"}
        size="sm"
        disabled={actions.balancing || shortSeats != null}
        onClick={() => reform("balance")}
      >
        {actions.balancing ? <Spinner className="mr-1.5 size-3.5" /> : <Shuffle className="mr-1.5 size-3.5" aria-hidden />}
        {draftMode ? tRoom("buildWithBalancer") : phase === "idle" ? tTeams("balance") : t("balanceAgain")}
      </Button>
      <ConfirmDialog
        open={reformOpen != null}
        onOpenChange={(open) => !open && setReformOpen(null)}
        intent={
          reformOpen === "balance"
            ? {
                title: tLobbies("rebalanceTitle"),
                description: tLobbies("rebalanceDescription"),
                confirmLabel: tLobbies("rebalanceConfirm"),
                tone: "danger"
              }
            : {
                title: tRoom("draftReformTitle"),
                description: tRoom("draftReformDescription"),
                confirmLabel: tRoom("draftReformConfirm"),
                tone: "danger"
              }
        }
        pending={actions.drafting || actions.balancing}
        onConfirm={() => {
          const kind = reformOpen;
          setReformOpen(null);
          if (kind === "draft") actions.onDraft();
          else if (kind === "balance") actions.onBalance();
        }}
      />
    </div>
  ) : null;

  if (phase === "idle") {
    return (
      <Card variant="flat" className="flex flex-col items-start gap-3 px-5 py-6">
        <h2 className={CARD_TITLE_CLASS}>{t("idleTitle")}</h2>
        <p className="text-body text-[color:var(--aqt-fg-muted)]">{canWrite ? t("idleHost") : t("idleViewer")}</p>
        {shortSeats != null ? <p className={CAPTION_CLASS}>{shortSeats}</p> : null}
        {formButtons}
      </Card>
    );
  }

  if (phase === "ready") {
    const opener = lobby.opener_index != null ? (teamNames[lobby.opener_index] ?? null) : null;
    return (
      <Card variant="flat" className="flex flex-col gap-0 overflow-hidden">
        <NextMapStrip
          nextMapId={lobby.next_map_id}
          maps={maps}
          matches={mixMatches}
          canWrite={canWrite}
          saving={actions.settingNextMap}
          capturing={false}
          onNextMapChange={actions.onNextMapChange}
        />
        <div className="flex flex-col items-start gap-3 border-t border-[color:var(--aqt-border)] px-5 py-5">
          <h2 className={CARD_TITLE_CLASS}>{t("readyTitle")}</h2>
          <p className="text-body text-[color:var(--aqt-fg-muted)]">
            {canWrite ? t("readyHost") : t("readyViewer")}
          </p>
          {opener != null ? <p className={CAPTION_CLASS}>{tRoom("opener", { team: opener })}</p> : null}
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <StartMatchButton
                awayNames={awayNames}
                opener={lobby.opener_index != null ? { names: teamNames, index: lobby.opener_index } : null}
                starting={actions.starting}
                onStart={actions.onStartMatch}
              />
              {formButtons}
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card variant="flat" className="flex flex-col items-start gap-3 px-5 py-6">
      <h2 className={CARD_TITLE_CLASS}>{t("liveTitle")}</h2>
      <p className="text-body text-[color:var(--aqt-fg-muted)]">
        {mapName != null ? tRoom("nextMap", { map: mapName }) : t("liveNoMap")}
      </p>
      {voiceUrl != null ? (
        <Button asChild variant="outline" size="sm">
          <a href={voiceUrl} target="_blank" rel="noreferrer">
            <Headphones aria-hidden="true" />
            {tRoom("voice")}
          </a>
        </Button>
      ) : null}
      {canWrite ? (
        <PickupResultControls
          teamCount={2}
          teamNames={teamNames}
          saving={actions.recording}
          pointsPerWin={game.settings.points_per_win ?? null}
          onRecord={actions.onRecord}
        />
      ) : (
        <p className={CAPTION_CLASS}>{t("liveViewer")}</p>
      )}
    </Card>
  );
}
