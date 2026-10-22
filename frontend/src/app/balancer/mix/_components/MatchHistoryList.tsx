"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { History, Undo2 } from "lucide-react";

import { lobbyLetter, teamAccent } from "@/app/balancer/mix/pickup-chrome";
import CatalogEntityImage from "@/components/catalog/CatalogEntityImage";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { formatRelative } from "@/components/kit/format-time";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { StatusDot } from "@/components/ui/status-dot";
import { useCatalogEntities } from "@/hooks/useCatalogEntities";
import { useFormatter } from "@/lib/datetime/client";
import { cn } from "@/lib/utils";
import type { CustomGameMatch } from "@/services/custom-game.service";
import type { CatalogEntityRead } from "@/types/catalog.types";

/** Every match this mix has recorded, every lobby, newest first — the permanent record `Record result` writes into. */
export function MatchHistoryList({
  matches,
  lobbyCount,
  canWrite,
  undoingMatchId,
  onUndoMatch,
  discipline
}: Readonly<{
  matches: CustomGameMatch[];
  lobbyCount: number;
  canWrite: boolean;
  undoingMatchId: number | null;
  onUndoMatch?: (matchId: number) => void;
  /** The mix's game, whose heroes name the bans. */
  discipline: string | null;
}>) {
  const t = useTranslations("mixes.matchHistory");
  // The heroes are read only once a round has bans to show (spec §8.4).
  const heroes = useCatalogEntities(matches.some((match) => match.bans.length > 0) ? discipline : null, "character");
  const heroById = new Map((heroes.data ?? []).map((hero) => [hero.id, hero]));
  // Newest first, so the first row of each lobby IS that lobby's newest -- the
  // only one the server will undo (`newest_id_for_lobby`).
  const newestPerLobby = new Set<number>();
  const seenLobbies = new Set<number>();
  for (const match of matches) {
    if (!seenLobbies.has(match.lobby_index)) {
      seenLobbies.add(match.lobby_index);
      newestPerLobby.add(match.id);
    }
  }
  // A mix that dropped a lobby keeps that lobby's matches in the log, so the
  // chip follows the history as well as the current count.
  const showLobby = lobbyCount > 1 || [...seenLobbies].some((index) => index > 0);

  return (
    <div className="flex flex-col gap-2 border-t border-[color:var(--aqt-border)] pt-3">
      <Eyebrow className="flex items-center gap-1.5">
        <History className="size-3.5" aria-hidden="true" />
        {t("title")}
      </Eyebrow>
      <ul className="flex flex-col gap-1.5">
        {matches.map((match) => (
          <MatchHistoryRow
            key={match.id}
            match={match}
            showLobby={showLobby}
            canUndo={newestPerLobby.has(match.id) && canWrite && onUndoMatch != null}
            undoing={undoingMatchId === match.id}
            onUndoMatch={onUndoMatch}
            heroById={heroById}
          />
        ))}
      </ul>
    </div>
  );
}

function MatchHistoryRow({
  match,
  showLobby,
  canUndo,
  undoing,
  onUndoMatch,
  heroById
}: Readonly<{
  match: CustomGameMatch;
  /** More than one lobby now, or one past the first somewhere in the log: say which one played it. */
  showLobby: boolean;
  canUndo: boolean;
  undoing: boolean;
  onUndoMatch?: (matchId: number) => void;
  heroById: Map<number, CatalogEntityRead>;
}>) {
  const t = useTranslations("mixes.lobbies");
  const tHistory = useTranslations("mixes.matchHistory");
  const tRoom = useTranslations("mixes.room");
  const format = useFormatter();
  const [first, second] = match.teams;
  const firstAccent = teamAccent(0);
  const secondAccent = teamAccent(1);
  const lobbyAccent = teamAccent(match.lobby_index);
  const letter = lobbyLetter(match.lobby_index);
  const [undoOpen, setUndoOpen] = useState(false);

  return (
    <li className="flex items-center gap-3 rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-1)] px-2.5 py-2">
      {showLobby ? (
        <IconTooltip label={t("tab", { letter })} className="shrink-0">
          <span
            data-testid="match-lobby"
            aria-hidden="true"
            className={cn(
              "flex size-5 items-center justify-center rounded font-display text-label font-extrabold",
              lobbyAccent.bar,
              "text-[color:var(--aqt-bg)]"
            )}
          >
            {letter}
          </span>
        </IconTooltip>
      ) : null}
      <CatalogEntityImage
        entity={{ name: match.map_name ?? "", image_path: match.map_image_path ?? null }}
        size={32}
        shape="wide"
        decorative
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-caption font-semibold leading-tight">
          <StatusDot className={cn("inline-block", firstAccent.bar)} />
          <span
            className={cn(
              "truncate",
              match.winner_slot === 1 ? "text-[color:var(--aqt-fg)]" : "text-[color:var(--aqt-fg-dim)]"
            )}
          >
            {first?.name}
          </span>
          <span className="tabular-nums text-[color:var(--aqt-fg-muted)]">
            {first?.score} : {second?.score}
          </span>
          <span
            className={cn(
              "truncate",
              match.winner_slot === 2 ? "text-[color:var(--aqt-fg)]" : "text-[color:var(--aqt-fg-dim)]"
            )}
          >
            {second?.name}
          </span>
          <StatusDot className={cn("inline-block", secondAccent.bar)} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-label text-[color:var(--aqt-fg-dim)]">
          <span className="truncate">{match.map_name ?? tRoom("noMap")}</span>
          <span aria-hidden="true">&middot;</span>
          <span className="shrink-0">{formatRelative(format, match.recorded_at)}</span>
        </div>
        {match.bans.length > 0 ? <HeroBanStrip bans={match.bans} heroById={heroById} className="mt-1" /> : null}
      </div>
      {canUndo ? (
        <>
          <IconTooltip control label={tHistory("undo")} hint={tHistory("undoHint")}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={tHistory("undo")}
              disabled={undoing}
              onClick={() => setUndoOpen(true)}
            >
              {undoing ? <Spinner /> : <Undo2 className="size-4" aria-hidden="true" />}
            </Button>
          </IconTooltip>
          <ConfirmDialog
            open={undoOpen}
            onOpenChange={setUndoOpen}
            intent={{
              title: tHistory("undoTitle"),
              description:
                match.points_per_win_applied != null
                  ? tHistory("undoPoints", { points: match.points_per_win_applied })
                  : tHistory("undoNoPoints"),
              confirmLabel: tHistory("undoConfirm"),
              tone: "danger"
            }}
            pending={undoing}
            onConfirm={() => {
              setUndoOpen(false);
              onUndoMatch?.(match.id);
            }}
          />
        </>
      ) : null}
    </li>
  );
}

/** Hero bans in the order they were made, each behind its team's dot: a recorded round's, or the live match's. */
export function HeroBanStrip({
  bans,
  heroById,
  className
}: Readonly<{
  bans: CustomGameMatch["bans"];
  heroById: Map<number, CatalogEntityRead>;
  className?: string;
}>) {
  const t = useTranslations("mixes.lobbies");
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)} aria-label={t("bans")}>
      {bans.map((ban, index) => {
        const hero = heroById.get(ban.item_id);
        return (
          <span key={`${ban.item_id}-${index}`} className="flex items-center gap-0.5">
            <StatusDot className={cn("inline-block", teamAccent(ban.slot - 1).bar)} />
            <CatalogEntityImage
              entity={{ name: hero?.name ?? `#${ban.item_id}`, image_path: hero?.image_path ?? null }}
              size={20}
            />
          </span>
        );
      })}
    </div>
  );
}
