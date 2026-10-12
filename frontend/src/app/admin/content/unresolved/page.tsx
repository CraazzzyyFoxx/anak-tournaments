"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { Check, CheckCircle, EyeOff } from "lucide-react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useFormatter } from "@/lib/datetime/client";

import { DataTable } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { FilterBar } from "@/components/kit/FilterBar";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import type { DateFormatter } from "@/components/kit/format-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SearchableImageSelect, {
  type SearchableImageOption,
} from "@/components/ui/searchable-image-select";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import adminService from "@/services/admin.service";
import type { CatalogAliasMissRead, CatalogEntityType } from "@/types/admin.types";
import { Spinner } from "@/components/ui/spinner";

import { MISS_QUEUE_KEY } from "../miss-queue";
import { adminQueryKeys } from "@/lib/admin/query-keys";

const ENTITY_TYPES: CatalogEntityType[] = ["hero", "map", "gamemode"];

/**
 * Query-key root of the admin list each entity type feeds. Attaching an alias
 * changes that list, so its cache has to go along with the miss queue's.
 */
const ENTITY_LIST_KEYS: Record<CatalogEntityType, string> = {
  hero: "heroes",
  map: "maps",
  gamemode: "gamemodes",
};

/** One page holds every catalog entity we have — ~45 maps, ~50 heroes, 7 modes. */
const ENTITY_PAGE_SIZE = 200;

function formatSeenAt(format: DateFormatter, value: string): string {
  return format.dateTime(new Date(value), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
        options: ENTITY_TYPES.map((entityType) => ({
          value: entityType,
          label: t(`catalog.${entityType}Entity`),
        })),
      },
      { key: "resolved", label: t("filters.includeResolved"), kind: "toggle" },
    ],
    [t]
  );
  const filters = useFilters(filterDefs);
  const entityTypeFilter = String(filters.values.type ?? "") as CatalogEntityType | "";
  const includeResolved = filters.values.resolved === true;

  const [heroesQuery, mapsQuery, gamemodesQuery] = useQueries({
    queries: [
      {
        queryKey: adminQueryKeys.contentAliasTargets("heroes"),
        queryFn: () => adminService.getHeroes({ per_page: ENTITY_PAGE_SIZE }),
      },
      {
        queryKey: adminQueryKeys.contentAliasTargets("maps"),
        queryFn: () => adminService.getMaps({ per_page: ENTITY_PAGE_SIZE }),
      },
      {
        queryKey: adminQueryKeys.contentAliasTargets("gamemodes"),
        queryFn: () => adminService.getGamemodes({ per_page: ENTITY_PAGE_SIZE }),
      },
    ],
  });

  const entityOptions: Record<CatalogEntityType, SearchableImageOption[]> = {
    hero: (heroesQuery.data?.results ?? []).map((hero) => ({
      value: String(hero.id),
      label: hero.name,
    })),
    // The gamemode disambiguates the handful of maps that share a name across
    // modes, which is exactly the pair the parser resolves.
    map: (mapsQuery.data?.results ?? []).map((map) => ({
      value: String(map.id),
      label: map.gamemode ? `${map.name} — ${map.gamemode.name}` : map.name,
    })),
    gamemode: (gamemodesQuery.data?.results ?? []).map((gamemode) => ({
      value: String(gamemode.id),
      label: gamemode.name,
    })),
  };

  const entityLoading: Record<CatalogEntityType, boolean> = {
    hero: heroesQuery.isLoading,
    map: mapsQuery.isLoading,
    gamemode: gamemodesQuery.isLoading,
  };

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
        entity_type: miss.entity_type,
        entity_id: entityId,
        alias: miss.raw_name,
      }),
    onSuccess: (_result, { miss }) => {
      notify.success(t("catalog.attached", { name: miss.raw_name, entity: t(`catalog.${miss.entity_type}Entity`).toLowerCase() }));
      invalidateQueue();
      // The alias now lives on the entity, so its admin list is stale too.
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.contentEntity(ENTITY_LIST_KEYS[miss.entity_type]) });
      queryClient.invalidateQueries({ queryKey: [ENTITY_LIST_KEYS[miss.entity_type]] });
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

  /**
   * The row's target picker. Rendered twice — in the "Attach to" column and,
   * below `md`, inside the card — because without it the Attach button on a
   * phone would be permanently disabled with no way to arm it.
   */
  const targetPicker = (miss: CatalogAliasMissRead) => {
    if (!isSuperuser) {
      return null;
    }
    if (miss.resolved_at) {
      return <StatusIcon icon={CheckCircle} label={t("catalog.resolved")} variant="success" />;
    }

    return (
      <SearchableImageSelect
        value={targets.get(miss.id)?.toString()}
        onValueChange={(next) => {
          setTargets((previous) => {
            const updated = new Map(previous);
            if (next === undefined) {
              updated.delete(miss.id);
            } else {
              updated.set(miss.id, Number(next));
            }
            return updated;
          });
        }}
        options={entityOptions[miss.entity_type]}
        placeholder={t("catalog.pickEntity", { entity: t(`catalog.${miss.entity_type}Entity`).toLowerCase() })}
        searchPlaceholder={t("catalog.search")}
        isLoading={entityLoading[miss.entity_type]}
        disabled={entityLoading[miss.entity_type] || isBusy(miss.id)}
        triggerClassName="h-9"
      />
    );
  };

  const columns: ColumnDef<CatalogAliasMissRead>[] = [
    {
      id: "entity_type",
      header: t("columns.type"),
      size: 96,
      enableSorting: false,
      cell: ({ row }) => <Badge variant="outline">{t(`catalog.${row.original.entity_type}Entity`)}</Badge>,
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
        const { last_log_record_id: recordId, last_log_tournament_id: tournamentId } = row.original;
        if (recordId == null) {
          return <span className="text-muted-foreground">—</span>;
        }
        // No tournament means the record itself is gone (FK is ON DELETE SET
        // NULL on the id, and the join finds nothing) — show the id, not a
        // link into a tournament we cannot name.
        if (tournamentId == null) {
          return <code className="text-xs tabular-nums">#{recordId}</code>;
        }
        return (
          <Link
            href={`/admin/tournaments/${tournamentId}/matches/logs`}
            className="text-xs tabular-nums text-primary underline-offset-2 hover:underline"
          >
            #{recordId}
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

        return (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={entityId === undefined || busy}
              title={
                entityId === undefined
                  ? t("catalog.pickFirst", { entity: t(`catalog.${miss.entity_type}Entity`).toLowerCase() })
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
        entityTypeFilter,
        includeResolved,
        page,
        search,
        pageSize,
      ]}
      queryFn={async (page, search, pageSize) => {
        const response = await adminService.getCatalogAliasMisses({
          page,
          per_page: pageSize,
          entity_type: entityTypeFilter || undefined,
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
              entity: t(`catalog.${row.original.entity_type}Entity`),
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
