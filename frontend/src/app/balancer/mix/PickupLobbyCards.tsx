"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, DoorOpen, Shuffle } from "lucide-react";

import { CAPTION_CLASS, lobbyLetter, teamAccent } from "@/app/balancer/mix/pickup-chrome";
import { useLiveMinutes } from "@/app/balancer/mix/_hooks/useLiveMinutes";
import { LineupRow } from "@/app/balancer/mix/_components/LineupRow";
import { StartMatchButton } from "@/app/balancer/mix/_components/StartMatchButton";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Spinner } from "@/components/ui/spinner";
import { StatusDot } from "@/components/ui/status-dot";
import { slotCodeOrder } from "@/lib/roster/ontology";
import { cn } from "@/lib/utils";
import type { CustomGame, CustomGameLobby, CustomGamePlayer } from "@/services/custom-game.service";

import {
  lobbyCandidateCount,
  parseVariants,
  sortLineup,
  teamNamesByIndex,
  type MixOwner,
  type PickupRecordOutcomeInput,
} from "./pickup-lineup";

type PickupLobbyCardsProps = {
  game: CustomGame;
  rows: CustomGamePlayer[];
  owner: MixOwner;
  canWrite: boolean;
  /** The lobby whose balance / start / record is in flight, so only its button spins. */
  balancingLobby: number | null;
  startingLobby: number | null;
  recordingLobby: number | null;
  shufflingAll: boolean;
  onBalance: (lobbyIndex: number) => void;
  onStartMatch: (lobbyIndex: number) => void;
  onRecordOutcome: (input: PickupRecordOutcomeInput) => void;
  onShuffleAll: () => void;
};

const STATE_TONE = { idle: "neutral", ready: "accent", live: "danger" } as const;

/**
 * The overview of a mix running several lobbies (spec §7.5, A1): one card per lobby with its stage, one line about
 * it and the one action that stage calls for -- Balance, Start match or Record -- plus the way into its room. A
 * card's Balance is off, with the reason, while the lobby cannot fill its seats. Shuffle all lobbies re-forms every
 * lobby at once, so it waits while any match is live (the server refuses it too). Beside the cards, the players no
 * lobby seats: waiting for a seat, away, or on the bench. A one-lobby mix renders nothing: its room is the overview.
 */
export function PickupLobbyCards(props: Readonly<PickupLobbyCardsProps>) {
  const { game, rows, owner, canWrite, shufflingAll, onShuffleAll } = props;
  const t = useTranslations("mixes.lobbies");
  const [shuffleOpen, setShuffleOpen] = useState(false);
  if (game.lobby_count < 2) return null;
  const anyLive = game.lobbies.some((lobby) => lobby.live_encounter_id != null);
  const anyUnrecorded = game.lobbies.some((lobby) => lobby.lineup_recorded === false);
  return (
    <section className="flex flex-col gap-3">
      {canWrite ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={shufflingAll || anyLive}
            onClick={() => (anyUnrecorded ? setShuffleOpen(true) : onShuffleAll())}
          >
            {shufflingAll ? (
              <Spinner className="mr-1.5 size-3.5" />
            ) : (
              <Shuffle className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            {t("shuffleAll")}
          </Button>
          <ConfirmDialog
            open={shuffleOpen}
            onOpenChange={setShuffleOpen}
            intent={{
              title: t("shuffleTitle"),
              description: t("shuffleDescription"),
              confirmLabel: t("shuffleConfirm"),
              tone: "danger",
            }}
            pending={shufflingAll}
            onConfirm={() => {
              setShuffleOpen(false);
              onShuffleAll();
            }}
          />
        </div>
      ) : null}
      <ul aria-label={t("tabsLabel")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {game.lobbies.map((lobby) => (
          <LobbyCard key={lobby.lobby_index} {...props} lobby={lobby} />
        ))}
      </ul>
      <UnseatedGroups rows={rows} owner={owner} lobbyCount={game.lobby_count} />
    </section>
  );
}

function LobbyCard({
  game,
  rows,
  owner,
  canWrite,
  lobby,
  balancingLobby,
  startingLobby,
  recordingLobby,
  onBalance,
  onStartMatch,
  onRecordOutcome,
}: Readonly<PickupLobbyCardsProps & { lobby: CustomGameLobby }>) {
  const t = useTranslations("mixes.room");
  const tLobby = useTranslations("mixes.lobbies");
  const index = lobby.lobby_index;
  const letter = lobbyLetter(index);
  const state = lobby.state ?? "idle";
  const variant =
    parseVariants(lobby.balance_result, teamNamesByIndex(game.settings, index), slotCodeOrder(owner.ontology))[
      lobby.selected_variant_index
    ] ?? null;
  const candidates = lobbyCandidateCount(rows, index);
  const need = owner.lobbySize;
  const short = need != null && candidates < need;
  const away = new Set(rows.filter((row) => row.away).map((row) => String(row.workspace_member_id)));
  const awayNames = (variant?.teams ?? [])
    .flatMap((team) => team.seats)
    .filter((seat) => away.has(seat.uuid))
    .map((seat) => seat.name);
  const teamNames = [variant?.teams[0]?.name ?? "Team 1", variant?.teams[1]?.name ?? "Team 2"];
  const minutes = useLiveMinutes(state, lobby.live_started_at);
  const gap = variant?.stats.ratingGap ?? null;
  const detail =
    state === "live"
      ? minutes == null
        ? null
        : t("elapsed", { minutes })
      : state === "ready"
        ? gap == null
          ? null
          : t("gap", { gap: Math.round(gap) })
        : need == null
          ? null
          : t("shortSeats", { count: candidates, need });

  return (
    <Card variant="flat" asChild>
      <li className="flex flex-col gap-3 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("h-4 w-[3px] shrink-0 rounded-sm", teamAccent(index).bar)}
          />
          <span className="font-display text-base font-bold text-[color:var(--aqt-fg)]">
            {tLobby("tab", { letter })}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-caption text-[color:var(--aqt-fg-muted)]">
            <StatusDot tone={STATE_TONE[state]} pulse={state === "live"} className="size-2" />
            {t(`state.${state}`)}
          </span>
        </div>
        {detail ? <p className={CAPTION_CLASS}>{detail}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && state === "idle" ? (
            <Button
              type="button"
              disabled={short || balancingLobby === index}
              title={
                short && need != null ? t("shortSeats", { count: candidates, need }) : undefined
              }
              onClick={() => onBalance(index)}
            >
              {balancingLobby === index ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <Shuffle className="mr-1.5 size-3.5" aria-hidden="true" />
              )}
              {t("balance")}
            </Button>
          ) : null}
          {canWrite && state === "ready" ? (
            <StartMatchButton
              awayNames={awayNames}
              starting={startingLobby === index}
              onStart={() => onStartMatch(index)}
            />
          ) : null}
          {canWrite && state === "live" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" disabled={recordingLobby === index}>
                  {recordingLobby === index ? <Spinner className="mr-1.5 size-3.5" /> : null}
                  {t("record")}
                  <ChevronDown className="ml-1.5 size-3.5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() => onRecordOutcome({ outcome: { winner: 1 }, lobbyIndex: index })}
                >
                  {t("teamWin", { team: teamNames[0] })}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onRecordOutcome({ outcome: { winner: null }, lobbyIndex: index })}
                >
                  {t("draw")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onRecordOutcome({ outcome: { winner: 2 }, lobbyIndex: index })}
                >
                  {t("teamWin", { team: teamNames[1] })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button asChild variant="ghost" className="ml-auto">
            <Link href={`/balancer/mix/${game.id}/lobby/${letter}`}>
              <DoorOpen className="mr-1.5 size-3.5" aria-hidden="true" />
              {t("openRoom")}
            </Link>
          </Button>
        </div>
      </li>
    </Card>
  );
}

/**
 * The players no lobby seats right now (spec §7.5, A1/F), each in one group: waiting for a seat, away (whatever their
 * participation -- away overrides it), or on the bench. The lineup's own rows, read-only: the host edits them in the
 * lineup beside the cards.
 */
function UnseatedGroups({
  rows,
  owner,
  lobbyCount,
}: Readonly<{ rows: CustomGamePlayer[]; owner: MixOwner; lobbyCount: number }>) {
  const t = useTranslations("mixes.room");
  const lineup = sortLineup(rows);
  const groups = [
    {
      key: "waiting",
      rows: lineup.filter((row) => !row.away && row.participation !== "benched" && row.current_lobby == null),
    },
    { key: "away", rows: lineup.filter((row) => row.away) },
    { key: "bench", rows: lineup.filter((row) => !row.away && row.participation === "benched") },
  ] as const;
  return (
    <div className="grid gap-3 2xl:grid-cols-3">
      {groups.map((group) => (
        <section
          key={group.key}
          aria-label={t(`groups.${group.key}`)}
          className="flex flex-col gap-1.5 rounded-xl border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-1)] px-2.5 py-2.5"
        >
          <div className="flex items-baseline gap-1.5 px-0.5">
            <Eyebrow>{t(`groups.${group.key}`)}</Eyebrow>
            <span className="text-label text-[color:var(--aqt-fg-dim)]">{group.rows.length}</span>
          </div>
          {group.rows.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {group.rows.map((row) => (
                // `canWrite={false}` leaves none of the row's write controls reachable, so its handlers never fire.
                <LineupRow
                  key={row.workspace_member_id}
                  row={row}
                  rotationHint={undefined}
                  owner={owner}
                  canWrite={false}
                  lobbyCount={lobbyCount}
                  saving={false}
                  dimmed={group.key === "bench"}
                  onPatch={() => {}}
                  onOpen={() => {}}
                  onRemove={() => {}}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
