"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Gavel, ListChecks, Pencil, Upload } from "lucide-react";

import { AuditTrailButton } from "@/components/kit/AuditTrailSheet";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import TeamName from "@/components/TeamName";
import { Button } from "@/components/ui/button";
import { TournamentLogUploadDialog } from "@/components/logs/TournamentLogUploadDialog";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import { pregameRoomHref } from "@/lib/encounter/pregame-room";
import adminService from "@/services/admin.service";
import type { AdminMatchRow } from "@/types/admin.types";
import type { Encounter } from "@/types/encounter.types";
import { reportOf, scoreline } from "@/lib/encounter/reports";
import { isLobby, seatsBySlot, seatTeam } from "@/lib/encounter/seats";

import { EncounterStatusCell, InspectorField } from "./EncounterCells";

/**
 * What the row detail adds to the table: the captains' filings and the maps a
 * parser has already read, both fetched only for the row actually open.
 */
export function EncounterInspectorPanel({
  encounter,
  workspaceId
}: Readonly<{
  encounter: Encounter;
  workspaceId: number;
}>) {
  const t = useTranslations("adminMatches.encounters");
  const commonT = useTranslations("adminMatches.common");
  const reportsQuery = useQuery({
    queryKey: encounterQueryKeys.reportsByEncounter(encounter.id, workspaceId),
    queryFn: () =>
      adminService.listEncounterReports({
        workspace_id: workspaceId,
        tournament_id: encounter.tournament_id,
        query: encounter.name,
        per_page: 25
      })
  });
  const reportRow = reportsQuery.data?.results.find((row) => row.id === encounter.id) ?? null;

  const parsedMapsQuery = useQuery({
    queryKey: adminQueryKeys.matchEncounter(encounter.id, workspaceId),
    queryFn: () =>
      adminService.listAdminMatches({
        workspace_id: workspaceId,
        encounter_id: encounter.id,
        per_page: 25
      })
  });

  const seats = seatsBySlot(encounter.teams);
  const seatIds = seats.map((seat) => seat.id);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <InspectorField label={t("teams")}>
          <span className="flex items-center gap-1.5">
            {seats.map((seat, index) => (
              <Fragment key={seat.id}>
                {index > 0 ? <span className="text-muted-foreground">{t("vs")}</span> : null}
                <TeamName team={seatTeam(seat)} fallback={commonT("tbd")} size="xs" />
              </Fragment>
            ))}
          </span>
        </InspectorField>
        <InspectorField label={t("score")}>
          <span className="font-mono tabular-nums">
            {seats.map((seat) => seat.score).join(" \u2013 ")}
          </span>
        </InspectorField>
        <InspectorField label={t("status")}>
          <EncounterStatusCell status={encounter.status} />
        </InspectorField>
        <InspectorField label={t("result")}>{t(`resultStatus.${encounter.result_status}`)}</InspectorField>
        <InspectorField label={t("bestOf")}>
          <span className="tabular-nums">{encounter.best_of}</span>
        </InspectorField>
        <InspectorField label={t("logs")}>{encounter.has_logs ? t("attached") : t("none")}</InspectorField>
      </div>

      <section className="rounded-xl border border-border/60 p-3">
        <p className={EYEBROW_CLASS}>{t("captainReports")}</p>
        {reportsQuery.isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("loading")}</p>
        ) : reportRow == null ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("noCaptainReport")}
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {seats.map((seat) => {
              const report = reportOf(reportRow.reports, seat.id);
              return (
                <li key={seat.id} className="flex items-center gap-2">
                  <span className="w-24 truncate text-xs uppercase text-muted-foreground" title={seat.name}>
                    {seat.name}
                  </span>
                  {report ? (
                    <>
                      <span className="font-mono tabular-nums">{scoreline(report.results, seatIds)}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {report.reporter_name ?? commonT("unknown")}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">{commonT("noReport")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border/60 p-3">
        <p className={EYEBROW_CLASS}>{t("parsedMaps", { count: parsedMapsQuery.data?.total ?? 0 })}</p>
        {parsedMapsQuery.isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("loading")}</p>
        ) : (parsedMapsQuery.data?.results.length ?? 0) === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("noParsedMap")}
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {(parsedMapsQuery.data?.results ?? []).map((map: AdminMatchRow) => (
              <li key={map.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{map.map_name}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {map.home_score}&ndash;{map.away_score}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The header actions of the same row: every write an admin can start from it. */
export function EncounterInspectorActions({
  encounter,
  workspaceId,
  canUpdate,
  reportsHref,
  returnTo,
  onEdit,
  onUploaded
}: Readonly<{
  encounter: Encounter;
  workspaceId: number;
  canUpdate: boolean;
  /** Where the captain reports view lives for this scope. */
  reportsHref: string;
  /** Where the pre-game room hands the organizer back — this list, as filtered. */
  returnTo: string;
  onEdit: (encounter: Encounter) => void;
  onUploaded: () => void;
}>) {
  const t = useTranslations("adminMatches.encounters");
  return (
    <>
      {isLobby(encounter) ? null : (
        <Button asChild variant="outline" size="sm">
          {/* Readiness, the veto and the per-map reports all live in the room,
              and the organizer controls there are the same ones a captain
              cannot reach. */}
          <Link href={pregameRoomHref(encounter.tournament_id, encounter.id, returnTo)}>
            <ListChecks aria-hidden className="size-3.5" />
            {t("openRoom")}
          </Link>
        </Button>
      )}
      {canUpdate ? (
        <Button variant="outline" size="sm" onClick={() => onEdit(encounter)}>
          <Pencil aria-hidden className="size-3.5" />
          {t("edit")}
        </Button>
      ) : null}
      {canUpdate ? (
        <TournamentLogUploadDialog
          tournamentId={encounter.tournament_id}
          encounters={[encounter]}
          initialEncounterId={encounter.id}
          onUploaded={onUploaded}
          trigger={
            <Button variant="outline" size="sm">
              <Upload aria-hidden className="size-3.5" />
              {t("uploadLog")}
            </Button>
          }
        />
      ) : null}
      {canUpdate ? (
        <Button asChild variant="outline" size="sm">
          {/* The captain reports view owns resolution: score, status,
              result_status and the audit row move together there. */}
          <Link
            href={`${reportsHref}${reportsHref.includes("?") ? "&" : "?"}search=${encodeURIComponent(encounter.name)}&id=${encounter.id}`}
          >
            <Gavel aria-hidden className="size-3.5" />
            {t("resolve")}
          </Link>
        </Button>
      ) : null}
      <AuditTrailButton
        scope={{ entityType: "encounter", entityId: encounter.id, workspaceId }}
        target={encounter.name}
      />
    </>
  );
}
