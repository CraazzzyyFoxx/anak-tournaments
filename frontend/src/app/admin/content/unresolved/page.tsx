"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { Check, CheckCircle, EyeOff } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter } from "@/lib/datetime/client";

import { DataTable } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import type { DateFormatter } from "@/components/kit/format-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SearchableImageSelect from "@/components/ui/searchable-image-select";
import { useDisciplines } from "@/hooks/useDisciplineMetadata";
import { useKindLabel } from "@/hooks/useKindLabel";
import { usePermissions } from "@/hooks/usePermissions";
import { catalogQueryKeys } from "@/lib/catalog/query-keys";
import { WHOLE_CATALOG } from "@/lib/catalog/query-options";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { CatalogAliasMissKind, CatalogAliasMissRead } from "@/types/admin.types";
import type { CatalogKind } from "@/types/catalog.types";
import { Spinner } from "@/components/ui/spinner";

import { MISS_QUEUE_KEY } from "../miss-queue";

const MISS_KINDS: CatalogAliasMissKind[] = ["character", "map", "mode", "stat", "event", "role"];

/**
 * Only a `character|map|mode` miss names a catalog entity an alias can be attached to — and its targets are that
 * miss's OWN discipline's rows of its kind. Stat, event and role misses name codes a game module declares: dismiss
 * is their only action, never an alias or a new definition.
 */
function attachableKind(miss: CatalogAliasMissRead): CatalogKind | null {
  return miss.kind === "character" || miss.kind === "map" || miss.kind === "mode" ? miss.kind : null;
}

function formatSeenAt(format: DateFormatter, value: string): string {
  return format.dateTime(new Date(value), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The row's target picker: the entities of the miss's discipline and kind, loaded when the row renders and shared by
 * every row that names the same game and kind. Rendered twice — in the "Attach to" column and, below `md`, inside
 * the card — because without it the Attach button on a phone would be permanently disabled with no way to arm it.
 */
function MissTargetPicker({
  miss,
  kind,
  value,
  onChange,
  disabled,
}: Readonly<{
  miss: CatalogAliasMissRead;
  kind: CatalogKind;
  value: number | undefined;
  onChange: (entityId: number | undefined) => void;
  disabled: boolean;
}>) {
  const t = useTranslations("adminWorkspace.content");
  const labelOf = useKindLabel();
  const disciplines = useDisciplines("all");
  const targets = useQuery({
    queryKey: catalogQueryKeys.adminList({ discipline: miss.discipline }, kind, WHOLE_CATALOG),
    queryFn: ({ signal }) => adminService.listCatalogEntities(miss.discipline, kind, WHOLE_CATALOG, { signal }),
  });
  const descriptor = disciplines.data?.find((discipline) => discipline.code === miss.discipline);
  const kindLabel = (descriptor ? labelOf(descriptor, kind) : t(`catalog.kinds.${kind}`)).toLowerCase();

  // The mode disambiguates the handful of maps that share a name across modes, which is exactly the pair the
  // parser resolves.
  const options = (targets.data?.results ?? []).map((entity) => ({
    value: String(entity.id),
    label: entity.parent ? `${entity.name} — ${entity.parent.name}` : entity.name,
  }));

  if (targets.isError) {
    return <span className="text-xs text-muted-foreground">{t("catalog.targetsError")}</span>;
  }
  return (
    <SearchableImageSelect
      value={value?.toString()}
      onValueChange={(next) => onChange(next === undefined ? undefined : Number(next))}
      options={options}
      placeholder={t("catalog.pickEntity", { entity: kindLabel })}
      searchPlaceholder={t("catalog.search")}
      isLoading={targets.isLoading}
      disabled={targets.isLoading || disabled}
      triggerClassName="h-9"
    />
  );
}

/**
 * The triage queue of log names the parser could not resolve (F13).
 *
 * Not a fourth catalogue: it edits nothing itself, it decides which catalogue
 * entity an unrecognised string meant. That decision is the screen's whole
 * job, so it stays inline — pick a target, press Attach — instead of moving
 * into a dialog the way an entity edit would.
 */
export default function UnresolvedNamesAdminPage() {
  const t = useTranslations("adminWorkspace.content");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { isSuperuser } = usePermissions();
  // Target entity per miss row. Dynamic, per-row keys that come and go with the
  // queue, so a Map rather than an object literal.
  const [targets, setTargets] = useState<Map<number, number>>(new Map());

  const filterDefs = useMemo<FilterDef[]>(
    () => [
      {
        key: "type",
        label: t("filters.type"),
        kind: "single",
        options: MISS_KINDS.map((kind) => ({
          value: kind,
          label: t(`catalog.kinds.${kind}`),
        })),
      },
      { key: "resolved", label: t("filters.includeResolved"), kind: "toggle" },
    ],
    [t]
  );
  const filters = useFilters(filterDefs);
  const kindFilter = String(filters.values.type ?? "") as CatalogAliasMissKind | "";
  const includeResolved = filters.values.resolved === true;

  // Also refreshes the tab badge: it hangs off the same key root.
  const invalidateQueue = () => {
    queryClient.invalidateQueries({ queryKey: MISS_QUEUE_KEY });
  };

  const forgetTarget = (missId: number) => {
    setTargets((previous) => {
      const next = new Map(previous);
      next.delete(missId);
      return next;
    });
  };

  const attachMutation = useMutation({
    mutationFn: ({ miss, entityId }: { miss: CatalogAliasMissRead; entityId: number }) =>
      adminService.attachCatalogAlias({
        entity_id: entityId,
        alias: miss.raw_name,
      }),
    onSuccess: (_result, { miss }) => {
      const kind = attachableKind(miss);
      notify.success(t("catalog.attached", { name: miss.raw_name, entity: t(`catalog.kinds.${miss.kind}`).toLowerCase() }));
      invalidateQueue();
      if (kind !== null) {
        // The alias now lives on the entity, so every cached read of that game's kind (public and admin) is stale.
        // The miss's own discipline and kind, captured with the submit, never the page's current view.
        queryClient.invalidateQueries({ queryKey: catalogQueryKeys.kind({ discipline: miss.discipline }, kind) });
      }
      forgetTarget(miss.id);
    },
    onError: (error) => notify.apiError(error, { title: t("catalog.attachError") }),
  });

  const dismissMutation = useMutation({
    mutationFn: (miss: CatalogAliasMissRead) => adminService.dismissCatalogAliasMiss(miss.id),
    onSuccess: (_result, miss) => {
      notify.success(t("catalog.hidden", { name: miss.raw_name }));
      invalidateQueue();
      forgetTarget(miss.id);
    },
    onError: (error) => notify.apiError(error, { title: t("catalog.hideError") }),
  });

  const isBusy = (missId: number) =>
    (attachMutation.isPending && attachMutation.variables?.miss.id === missId) ||
    (dismissMutation.isPending && dismissMutation.variables?.id === missId);

  const targetPicker = (miss: CatalogAliasMissRead) => {
    if (!isSuperuser) {
      return null;
    }
    if (miss.resolved_at) {
      return <StatusIcon icon={CheckCircle} label={t("catalog.resolved")} variant="success" />;
    }
    const kind = attachableKind(miss);
    if (kind === null) {
      return <span className="text-xs text-muted-foreground">{t("catalog.dismissOnly")}</span>;
    }

    return (
      <MissTargetPicker
        miss={miss}
        kind={kind}
        value={targets.get(miss.id)}
        onChange={(entityId) => {
          setTargets((previous) => {
            const updated = new Map(previous);
            if (entityId === undefined) {
              updated.delete(miss.id);
            } else {
              updated.set(miss.id, entityId);
            }
            return updated;
          });
        }}
        disabled={isBusy(miss.id)}
      />
    );
  };

  const columns: ColumnDef<CatalogAliasMissRead>[] = [
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
      cell: ({ row }) => targetPicker(row.original),
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
        const busy = isBusy(miss.id);
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
                onClick={() => attachMutation.mutate({ miss, entityId: entityId! })}
              >
                {busy && attachMutation.isPending ? (
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
              onClick={() => dismissMutation.mutate(miss)}
            >
              <EyeOff aria-hidden className="h-4 w-4" />
              {t("actions.dismiss")}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      filterKey={filters.filterKey}
      queryKey={(page, search, pageSize) => [
        ...MISS_QUEUE_KEY,
        kindFilter,
        includeResolved,
        page,
        search,
        pageSize,
      ]}
      queryFn={async (page, search, pageSize) => {
        const response = await adminService.getCatalogAliasMisses({
          page,
          per_page: pageSize,
          kind: kindFilter || undefined,
          include_resolved: includeResolved,
        });
        if (!search) {
          return response;
        }
        // ponytail: `misses_list` takes no search term, so the box narrows the
        // page in hand. Enough for a queue that lives in the dozens; lift by
        // adding `search` to the RPC once it grows past one page.
        const needle = search.toLowerCase();
        const results = response.results.filter((miss) =>
          miss.raw_name.toLowerCase().includes(needle)
        );
        return { ...response, results, total: results.length };
      }}
      columns={columns}
      searchPlaceholder={t("catalog.search")}
      toolbar={<FilterBar defs={filterDefs} filters={filters} />}
      emptyMessage={
        includeResolved
          ? t("catalog.noResolved")
          : t("catalog.nothing")
      }
      renderMobileCard={(row) => (
        <div className="min-w-0 flex-1 space-y-1.5">
          <code className="block truncate rounded bg-muted/40 px-1.5 py-0.5 text-xs">
            {row.original.raw_name}
          </code>
          <p className="truncate text-xs text-muted-foreground">
            {t("catalog.mobileSummary", {
              entity: `${row.original.discipline} · ${t(`catalog.kinds.${row.original.kind}`)}`,
              count: row.original.occurrences,
              date: formatSeenAt(format, row.original.last_seen_at),
            })}
          </p>
          {targetPicker(row.original)}
        </div>
      )}
    />
  );
}
