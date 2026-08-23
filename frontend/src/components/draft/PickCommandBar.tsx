"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck, Shuffle, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { OverlayBar } from "@/components/ui/overlay-bar";
import { Button } from "@/components/ui/button";
import DivisionIcon from "@/components/DivisionIcon";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";
import { resolveDivisionFromRank } from "@/lib/division-grid";
import { getRoleIconName, ROLE_ACCENT } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { DraftBoard, DraftPlayer, DraftRole } from "@/types/draft.types";
import type { RealtimeConnectionState } from "@/types/realtime.types";
import type { DivisionGrid } from "@/types/workspace.types";

import { DraftClockRing } from "./DraftClockRing";
import { resolveDraftAccent } from "@/lib/draft-visual";
import { picksUntilTeamTurn, slotRankForPlayer } from "@/lib/draft-workspace-model";

interface PickCommandBarProps {
  player: DraftPlayer | null;
  role: DraftRole | null;
  teamName: string;
  canConfirm: boolean;
  pending: boolean;
  connectionState: RealtimeConnectionState;
  announcement: string;
  onConfirm: () => void;
  divisionGrid: DivisionGrid;
  board: DraftBoard;
  isMyPick: boolean;
  myTeamId: number | null;
}

export function PickCommandBar({
  player,
  role,
  teamName,
  canConfirm,
  pending,
  connectionState,
  announcement,
  onConfirm,
  divisionGrid,
  board,
  isMyPick,
  myTeamId
}: Readonly<PickCommandBarProps>) {
  const t = useTranslations("draftRedesign");
  const [reviewOpen, setReviewOpen] = useState(false);
  const isConnected = connectionState === "connected";
  const ready = canConfirm && !pending;
  // A role-less (all-flex) roster drops the requested role server-side, so the
  // bar names the slot the pick actually fills — and its rank, which is the
  // player's best, not the rank of a role nobody is assigned.
  const shape = board.session.roster_shape;
  const slotLabel = shape.has_role_slots && role ? t(`roles.${role}`) : t("roles.flex");
  const selection = player && role ? `${player.battle_tag ?? `#${player.id}`} · ${slotLabel}` : t("noSelection");
  const roleRank = player && role ? slotRankForPlayer(player, role, shape) : null;
  const roleDivision = roleRank != null ? resolveDivisionFromRank(divisionGrid, roleRank) : null;
  const accent = resolveDraftAccent(board);
  const current = board.current_pick;
  const onClockTeamName = board.teams.find((tm) => tm.id === current?.draft_team_id)?.name ?? "—";
  const picksUntilMyTurn =
    !isMyPick && board.session.status === "live" && myTeamId != null
      ? picksUntilTeamTurn(board.picks, myTeamId)
      : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat || !canConfirm || pending) return;
      // Enter already activates whatever holds focus. Without this guard the
      // shortcut fires on top of that, so toggling a shortlist bookmark or
      // picking a role would also open the confirmation dialog.
      const el = event.target as HTMLElement | null;
      if (
        el?.closest(
          "a,button,input,textarea,select,summary,[role=button],[role=tab],[role=radio],[role=option],[contenteditable=true]"
        )
      ) {
        return;
      }
      event.preventDefault();
      setReviewOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canConfirm, pending]);

  return (
    <>
      <OverlayBar
        tone={!isConnected ? "warn" : ready ? "active" : "neutral"}
        ariaLabel={t("pickCommand")}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {/* `sm:contents` dissolves this mobile-only row so the wide layout keeps
              clock, meta, selection and the button on one line. */}
          <div className="flex min-w-0 items-center gap-2 sm:contents">
            <DraftClockRing expiresAt={current?.clock_expires_at ?? null} paused={board.session.status === "paused"} totalSeconds={board.session.pick_time_seconds} accent={accent} />
            <div className="min-w-0 shrink-0 border-r border-[color:var(--aqt-border-2)] pr-3 sm:pr-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[color:var(--aqt-teal)]">{isMyPick ? t("yourTurn") : t("onClockLabel")}</p>
              <p className="text-sm font-semibold">
                <span className="hidden sm:inline">
                  <span className="inline-block max-w-[12rem] truncate align-bottom" title={onClockTeamName}>{onClockTeamName}</span>{" · "}
                </span>
                <span className="font-normal text-[color:var(--aqt-fg-muted)]">{t("pickMeta", { pick: current?.overall_no ?? 0, total: board.picks.length })}</span>
              </p>
              {picksUntilMyTurn != null && (
                <p className="mt-0.5 text-xs text-[color:var(--aqt-fg-muted)]">{t("yourTurnInPicks", { n: picksUntilMyTurn })}</p>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--aqt-fg-faint)]">{t("selectionFor", { team: teamName })}</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                {player && role ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate" title={player.battle_tag ?? undefined}>{player.battle_tag ?? `#${player.id}`}</span>
                    {shape.has_role_slots ? (
                      <PlayerRoleIcon role={getRoleIconName(role)} size={18} color={ROLE_ACCENT[role]} />
                    ) : (
                      <Shuffle className="h-4 w-4 shrink-0 text-[color:var(--aqt-fg-muted)]" aria-hidden />
                    )}
                  </span>
                ) : (
                  <span className="line-clamp-2 text-[color:var(--aqt-fg-muted)]">{t("noSelection")}</span>
                )}
                {roleDivision != null && (
                  <DivisionIcon division={roleDivision} tournamentGrid={divisionGrid} width={24} height={24} className="h-6 w-6 shrink-0 object-contain" />
                )}
              </p>
            </div>
            {!isConnected && (
              <span className="flex shrink-0 items-center gap-2 text-sm text-[color:var(--aqt-warm)]">
                <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
                <span className="sr-only lg:not-sr-only">{t("waitingFreshData")}</span>
              </span>
            )}
          </div>
          <Button
            className={cn(
              "min-h-11 w-full sm:w-auto sm:shrink-0",
              !isConnected && "bg-[color:var(--aqt-warm)] text-[color:var(--aqt-bg)] hover:bg-[color:var(--aqt-warm)]/90",
              ready && "ring-2 ring-[color:var(--aqt-teal)]/40 ring-offset-2 ring-offset-[color:var(--aqt-card)]"
            )}
            disabled={!canConfirm || pending}
            onClick={() => setReviewOpen(true)}
          >
            <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />
            {t("reviewPick")}
            {ready && (
              <span className="ml-1 hidden items-center rounded border border-current/40 px-1.5 py-0.5 font-mono text-[11px] font-normal opacity-80 sm:inline-flex">
                {t("enterHint")}
              </span>
            )}
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">{announcement}</p>
      </OverlayBar>
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmPickTitle")}</DialogTitle>
            <DialogDescription>
              {t("confirmPickDescription", {
                player: player?.battle_tag ?? (player ? `#${player.id}` : "—"),
                team: teamName,
                role: role ? t(`roles.${role}`) : "—"
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 rounded-xl bg-[color:var(--aqt-card-2)] p-4">
            <Check className="h-5 w-5 text-[color:var(--aqt-support)]" />
            <span className="font-medium">{selection}</span>
          </div>
          <DialogFooter>
            <Button
              disabled={!canConfirm || pending}
              onClick={() => {
                onConfirm();
                setReviewOpen(false);
              }}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}{t("confirmPick")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
