"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, EyeOff } from "lucide-react";

import { columnMeta } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useFormatter } from "@/lib/datetime/client";
import type { CatalogAliasMissRead } from "@/types/admin.types";

import { attachableKind, formatSeenAt } from "./model";
import { MissTarget } from "./UnresolvedCells";

/** One unresolved name: where it came from, how often, and — for a superuser — the inline attach/dismiss. */
export function useUnresolvedColumns({
  isSuperuser,
  targets,
  attachingId,
  dismissingId,
  onPickTarget,
  onAttach,
  onDismiss,
}: Readonly<{
  isSuperuser: boolean;
  /** Target entity picked per miss row. */
  targets: ReadonlyMap<number, number>;
  /** The miss an attach / a dismiss is in flight for. */
  attachingId: number | undefined;
  dismissingId: number | undefined;
  /** Stable identities required: every row's cells close over them. */
  onPickTarget: (missId: number, entityId: number | undefined) => void;
  onAttach: (variables: { miss: CatalogAliasMissRead; entityId: number }) => void;
  onDismiss: (miss: CatalogAliasMissRead) => void;
}>): ColumnDef<CatalogAliasMissRead>[] {
  const t = useTranslations("adminWorkspace.content");
  const format = useFormatter();
  return useMemo<ColumnDef<CatalogAliasMissRead>[]>(
    () => [
      {
        id: "discipline",
        header: t("columns.discipline"),
        size: 96,
        enableSorting: false,
        cell: ({ row }) => <code className="text-xs">{row.original.discipline}</code>,
      },
      {
        id: "kind",
        header: t("columns.type"),
        size: 96,
        enableSorting: false,
        meta: columnMeta<CatalogAliasMissRead>({ align: "center" }),
        cell: ({ row }) => <Badge variant="outline">{t(`catalog.kinds.${row.original.kind}`)}</Badge>,
      },
      {
        id: "raw_name",
        header: t("columns.rawName"),
        size: 200,
        enableSorting: false,
        cell: ({ row }) => (
          <code className="rounded bg-muted/40 px-1.5 py-0.5 text-xs">{row.original.raw_name}</code>
        ),
      },
      {
        id: "occurrences",
        header: t("columns.timesSeen"),
        size: 96,
        enableSorting: false,
        cell: ({ row }) => <span className="tabular-nums">{row.original.occurrences}</span>,
      },
      {
        id: "last_seen_at",
        header: t("columns.lastSeen"),
        size: 128,
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className="text-xs tabular-nums text-muted-foreground"
            title={t("catalog.firstSeen", { date: formatSeenAt(format, row.original.first_seen_at) })}
          >
            {formatSeenAt(format, row.original.last_seen_at)}
          </span>
        ),
      },
      {
        id: "last_log",
        header: t("columns.lastLog"),
        size: 88,
        enableSorting: false,
        cell: ({ row }) => {
          const { last_ingest_job_id: jobId, last_log_tournament_id: tournamentId } = row.original;
          if (jobId == null) {
            return <span className="text-muted-foreground">—</span>;
          }
          // No tournament means the job carried no tournament hint (or is gone) —
          // show the id, not a link into a tournament we cannot name.
          if (tournamentId == null) {
            return <code className="text-xs tabular-nums">#{jobId}</code>;
          }
          return (
            <Link
              href={`/admin/tournaments/${tournamentId}/matches/logs`}
              className="text-xs tabular-nums text-primary underline-offset-2 hover:underline"
            >
              #{jobId}
            </Link>
          );
        },
      },
      {
        id: "target",
        header: t("columns.attachTo"),
        size: 240,
        enableSorting: false,
        cell: ({ row }) => {
          const miss = row.original;
          return (
            <MissTarget
              miss={miss}
              canTriage={isSuperuser}
              value={targets.get(miss.id)}
              onChange={(entityId) => onPickTarget(miss.id, entityId)}
              disabled={miss.id === attachingId || miss.id === dismissingId}
            />
          );
        },
      },
      {
        id: "actions",
        size: 168,
        cell: ({ row }) => {
          const miss = row.original;
          if (!isSuperuser || miss.resolved_at) {
            return null;
          }

          const entityId = targets.get(miss.id);
          const busy = miss.id === attachingId || miss.id === dismissingId;
          const kind = attachableKind(miss);

          return (
            <div className="flex items-center gap-1.5">
              {kind !== null && (
                <Button
                  type="button"
                  size="sm"
                  disabled={entityId === undefined || busy}
                  title={
                    entityId === undefined
                      ? t("catalog.pickFirst", { entity: t(`catalog.kinds.${kind}`).toLowerCase() })
                      : undefined
                  }
                  onClick={() => onAttach({ miss, entityId: entityId! })}
                >
                  {busy && attachingId !== undefined ? (
                    <Spinner />
                  ) : (
                    <Check aria-hidden className="h-4 w-4" />
                  )}
                  {t("actions.attach")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onDismiss(miss)}
              >
                <EyeOff aria-hidden className="h-4 w-4" />
                {t("actions.dismiss")}
              </Button>
            </div>
          );
        },
      },
    ],
    [t, format, isSuperuser, targets, attachingId, dismissingId, onPickTarget, onAttach, onDismiss]
  );
}
