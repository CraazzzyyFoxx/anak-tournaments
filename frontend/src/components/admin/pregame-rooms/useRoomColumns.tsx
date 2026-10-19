"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { columnMeta } from "@/components/data-table";
import { ScheduledAtCell } from "@/components/admin/encounters/EncounterCells";
import { StatusPill } from "@/components/kit/StatusPill";
import { Button } from "@/components/ui/button";
import { pregameRoomHref } from "@/lib/encounter/pregame-room";
import { cn } from "@/lib/utils";
import type { PregameKindSummary, PregameRoomRow } from "@/types/admin.types";

import { seatsBySlot } from "@/lib/encounter/seats";
import {
  ATTENTION_LABEL,
  ATTENTION_TONE,
  PHASE_LABEL,
  PHASE_TONE,
  currentStep,
  stepActionLabel
} from "./model";

type PregameTranslator = ReturnType<typeof useTranslations<"adminMatches.pregame">>;

function ReadinessCell({ room }: Readonly<{ room: PregameRoomRow }>) {
  return (
    <div className="flex flex-col gap-1">
      {seatsBySlot(room.teams).map((seat) => (
        <StatusPill
          key={seat.encounter_team_id}
          tone={room.readiness[String(seat.encounter_team_id)] ? "success" : "neutral"}
        >
          <span className="max-w-[9rem] truncate">{seat.name}</span>
        </StatusPill>
      ))}
    </div>
  );
}

/**
 * The step the room is holding, in the words the room itself uses: which round
 * of the series, how far through its order, what the acting side has to do —
 * or, when an organizer stepped in, that the session is paused or cancelled.
 */
function StepCell({ room, t }: Readonly<{ room: PregameRoomRow; t: PregameTranslator }>) {
  const step = currentStep(room);
  if (!step) return <span className="text-muted-foreground">—</span>;
  const { kind, summary } = step;
  const cancelled = summary.status === "cancelled";

  return (
    <div className="min-w-0 text-sm">
      <p className="flex min-w-0 items-center gap-1.5 truncate">
        <span className="text-muted-foreground">{kind === "map" ? t("maps") : t("heroes")}</span>
        {summary.current_round != null ? (
          <span className="text-muted-foreground">· R{summary.current_round}</span>
        ) : null}
        {summary.step_index != null ? (
          <span className="tabular-nums text-muted-foreground">
            · {summary.step_index + 1}/{summary.step_count}
          </span>
        ) : null}
        {cancelled ? <StatusPill tone="danger">{t("cancelled")}</StatusPill> : null}
        {summary.paused_at != null ? <StatusPill tone="warning">{t("paused")}</StatusPill> : null}
      </p>
      {cancelled ? (
        <p className="truncate text-xs text-muted-foreground">{t("cancelledByOrganizer")}</p>
      ) : summary.awaiting_choice ? (
        <p className="truncate text-xs text-warning">{t("waitingOpener")}</p>
      ) : (
        <p className="truncate text-xs text-muted-foreground">
          {t("stepSummary", {
            action: t(stepActionLabel(summary.step_action) as Parameters<PregameTranslator>[0]),
            blind: summary.step_blind ? t("blind") : "",
            sides:
              summary.acting_team_ids.length > 0
                ? ` · ${summary.acting_team_ids
                    .map((id) => room.teams.find((seat) => seat.encounter_team_id === id)?.name ?? "?")
                    .join(" & ")}`
                : ""
          })}
        </p>
      )}
    </div>
  );
}

// Module-level so their identity is stable: `useSyncExternalStore`
// resubscribes whenever the subscribe function it is handed changes.
function subscribeEverySecond(onTick: () => void): () => void {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}

function subscribeNever(): () => void {
  return () => {};
}

/**
 * Live countdown to the open step's deadline.
 *
 * Its own ticking clock rather than one in the browser: a `now` passed down
 * from the parent would rebuild every column definition each second, which is
 * the whole table re-rendering to move one number. The clock is an external
 * store snapshotted to the whole second, so repeated reads within a render
 * agree, and its server snapshot is `null`: rendering a remaining time on the
 * server would hydrate against a different second.
 */
function DeadlineCell({ summary, t }: Readonly<{ summary: PregameKindSummary | null; t: PregameTranslator }>) {
  const deadline = summary?.deadline_at ? Date.parse(summary.deadline_at) : null;
  const nowSecond = useSyncExternalStore<number | null>(
    deadline == null ? subscribeNever : subscribeEverySecond,
    () => Math.floor(Date.now() / 1000),
    () => null
  );

  if (deadline == null || Number.isNaN(deadline)) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (nowSecond == null) return <span className="text-muted-foreground tabular-nums">--:--</span>;

  const left = Math.round(deadline / 1000) - nowSecond;
  if (left <= 0) return <StatusPill tone="danger">{t("overdue")}</StatusPill>;

  const minutes = Math.floor(left / 60);
  return (
    <span className={cn("text-sm tabular-nums", left <= 30 && "font-semibold text-warning")}>
      {minutes}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

/**
 * One row per pre-game room: who plays, how far the room has got, and the one
 * link that takes an organizer into it.
 */
export function useRoomColumns({
  tournamentId,
  returnTo
}: Readonly<{
  tournamentId: number;
  /** Where "Open room" sends the organizer back to — this very screen. */
  returnTo: string;
}>): ColumnDef<PregameRoomRow>[] {
  const t = useTranslations("adminMatches.pregame");
  return useMemo<ColumnDef<PregameRoomRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("match"),
        meta: columnMeta<PregameRoomRow>({
          mandatory: true,
          searchValue: (row) =>
            [row.name, ...row.teams.map((seat) => seat.name)].filter(Boolean).join(" ")
        }),
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[20rem]">
            <p className="truncate font-medium text-foreground" title={row.original.name}>
              {row.original.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {t("matchDetails", {
                stage: row.original.stage_name ?? t("unassigned"),
                round: row.original.round,
                bestOf: t("bestOfShort"),
                bestOfValue: row.original.best_of
              })}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {seatsBySlot(row.original.teams)
                .map((seat) => seat.name)
                .join(` ${t("vs")} `) || t("tbd")}
              {row.original.teams.some((seat) => seat.score > 0) ? (
                <span className="font-mono tabular-nums">
                  {" "}
                  · {seatsBySlot(row.original.teams).map((seat) => seat.score).join("\u2013")}
                </span>
              ) : null}
            </p>
          </div>
        )
      },
      {
        accessorKey: "scheduled_at",
        header: t("scheduled"),
        size: 132,
        meta: columnMeta<PregameRoomRow>({ category: "core" }),
        cell: ({ row }) => <ScheduledAtCell value={row.original.scheduled_at} />
      },
      {
        id: "readiness",
        header: t("ready"),
        size: 148,
        enableSorting: false,
        meta: columnMeta<PregameRoomRow>({ category: "core" }),
        cell: ({ row }) => <ReadinessCell room={row.original} />
      },
      {
        accessorKey: "phase",
        header: t("phaseColumn"),
        size: 128,
        meta: columnMeta<PregameRoomRow>({ category: "core", align: "center" }),
        cell: ({ row }) => (
          <StatusPill tone={PHASE_TONE[row.original.phase]}>
            {t(PHASE_LABEL[row.original.phase] as Parameters<PregameTranslator>[0])}
          </StatusPill>
        )
      },
      {
        id: "step",
        header: t("currentStep"),
        enableSorting: false,
        meta: columnMeta<PregameRoomRow>({ category: "core" }),
        cell: ({ row }) => <StepCell room={row.original} t={t} />
      },
      {
        id: "timer",
        header: t("timer"),
        size: 96,
        enableSorting: false,
        meta: columnMeta<PregameRoomRow>({ category: "core", align: "center" }),
        cell: ({ row }) => <DeadlineCell summary={currentStep(row.original)?.summary ?? null} t={t} />
      },
      {
        id: "games",
        header: t("maps"),
        size: 112,
        enableSorting: false,
        meta: columnMeta<PregameRoomRow>({ category: "meta", align: "center" }),
        cell: ({ row }) => (
          <div className="text-sm">
            <span className="tabular-nums">
              {row.original.games.confirmed}/{row.original.games.total}
            </span>
            {row.original.games.disputed > 0 ? (
              <p className="text-xs text-danger">{t("disputedCount", { count: row.original.games.disputed })}</p>
            ) : null}
          </div>
        )
      },
      {
        id: "attention",
        header: t("attentionColumn"),
        enableSorting: false,
        meta: columnMeta<PregameRoomRow>({ category: "core" }),
        cell: ({ row }) =>
          row.original.attention.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.attention.map((flag) => (
                <StatusPill key={flag} tone={ATTENTION_TONE[flag]}>
                  {t(ATTENTION_LABEL[flag] as Parameters<PregameTranslator>[0])}
                </StatusPill>
              ))}
            </div>
          )
      },
      {
        id: "open",
        header: "",
        size: 128,
        enableSorting: false,
        enableResizing: false,
        meta: columnMeta<PregameRoomRow>({ align: "right" }),
        cell: ({ row }) => (
          <Button asChild variant="outline" size="sm">
            <Link href={pregameRoomHref(tournamentId, row.original.encounter_id, returnTo)}>
              <ExternalLink aria-hidden className="size-3.5" />
              {t("openRoom")}
            </Link>
          </Button>
        )
      }
    ],
    [tournamentId, returnTo, t]
  );
}
