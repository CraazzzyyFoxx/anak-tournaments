"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle, Clock, Trash2, UserCog } from "lucide-react";
import { useFormatter } from "@/lib/datetime/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { DataTable, columnMeta, createKebabColumn } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { PROVIDER_META, ProviderBadge } from "@/components/admin/OAuthProviderBadge";
import { FilterBar } from "@/components/kit/FilterBar";
import { Inspector } from "@/components/kit/Inspector";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { EYEBROW_CLASS } from "@/components/kit/tone";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { rbacService } from "@/services/rbac.service";
import type { OAuthConnectionAdmin, OAuthProvider } from "@/types/rbac.types";
import { accessQueryKeys } from "@/lib/access/query-keys";
import { useTranslations } from "next-intl";

const PAGE_SIZE = 20;

function isTokenExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function accountsHref(connection: OAuthConnectionAdmin): string {
  const needle = connection.auth_user_username ?? connection.auth_user_email ?? "";
  return `/admin/access/accounts?search=${encodeURIComponent(needle)}`;
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW_CLASS}>{label}</p>
      <div className="mt-0.5 break-words text-sm">{children}</div>
    </div>
  );
}

/**
 * OAuth connections (T2, F15): which provider account signs in as which auth
 * account.
 *
 * The provider `<Select>` in the toolbar is now a URL chip, so "every Discord
 * connection whose token expired" is a link rather than a sequence of clicks,
 * and the detail a support question actually needs — provider id, token
 * expiry, the auth account — moved from the row into the inspector.
 */
export default function OAuthConnectionsAdminPage() {
  const t = useTranslations("adminAccess.common");
  const to = useTranslations("adminAccess.oauthUi");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [], shallow: true });
  const openId = searchParams?.get("id") ?? null;
  const providerLabel = useCallback(
    (provider: OAuthProvider): string => t(PROVIDER_META[provider]?.labelKey ?? "provider"),
    [t]
  );

  const canDeleteConnections = hasPermission("auth_user.update");
  const [pageRows, setPageRows] = useState<OAuthConnectionAdmin[]>([]);
  const [pendingDelete, setPendingDelete] = useState<OAuthConnectionAdmin | null>(null);

  const defs = useMemo<FilterDef[]>(
    () => [
      {
        key: "provider",
        label: t("provider"),
        kind: "single",
        options: (Object.keys(PROVIDER_META) as OAuthProvider[]).map((provider) => ({
          value: provider,
          label: providerLabel(provider)
        }))
      }
    ],
    [providerLabel, t]
  );
  const filters = useFilters(defs);
  const providerFilter = String(filters.values.provider ?? "");

  const openRow = pageRows.find((row) => String(row.id) === openId) ?? null;
  const openIndex = openRow ? pageRows.indexOf(openRow) : -1;

  const deleteMutation = useMutation({
    mutationFn: (connectionId: number) => rbacService.deleteOAuthConnection(connectionId),
    onSuccess: async () => {
      const removed = pendingDelete;
      await queryClient.invalidateQueries({ queryKey: accessQueryKeys.oauthConnections() });
      setPendingDelete(null);
      if (removed && String(removed.id) === openId) setParams({ id: null });
      notify.success(to("removed"));
    },
    onError: (error) => notify.apiError(error)
  });

  const columns = useMemo<ColumnDef<OAuthConnectionAdmin>[]>(
    () => [
      {
        accessorKey: "id",
        header: "ID",
        size: 60,
        cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>
      },
      {
        accessorKey: "provider",
        header: t("provider"),
        cell: ({ row }) => <ProviderBadge provider={row.original.provider} />
      },
      {
        id: "provider_user",
        header: t("providerAccount"),
        enableSorting: false,
        cell: ({ row }) => {
          const connection = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="size-8">
                <AvatarImage src={connection.avatar_url ?? undefined} alt={connection.username} />
                <AvatarFallback className="text-xs">
                  {connection.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {connection.display_name ?? connection.username}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {connection.username}
                  {connection.email ? ` \u00B7 ${connection.email}` : ""}
                </p>
              </div>
            </div>
          );
        }
      },
      {
        id: "auth_user",
        header: t("authorization"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.original.auth_user_username}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.original.auth_user_email}
            </p>
          </div>
        )
      },
      {
        id: "token_status",
        header: t("token"),
        enableSorting: false,
        meta: columnMeta({ align: "center" }),
        cell: ({ row }) => {
          const expiresAt = row.original.token_expires_at;
          if (!expiresAt) {
            return <span className="text-xs text-muted-foreground">{t("noToken")}</span>;
          }
          const expired = isTokenExpired(expiresAt);
          return expired ? (
            <StatusIcon icon={Clock} label={t("expired")} variant="destructive" />
          ) : (
            <StatusIcon icon={CheckCircle} label={t("active")} variant="success" />
          );
        }
      },
      {
        accessorKey: "created_at",
        header: t("connected"),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {format.dateTime(new Date(row.original.created_at), {
              year: "numeric",
              month: "short",
              day: "numeric"
            })}
          </span>
        )
      },
      createKebabColumn<OAuthConnectionAdmin>(
        (row) => [
          { label: t("openAuthAccount"), icon: UserCog, href: accountsHref(row) },
          {
            label: t("removeConnection"),
            icon: Trash2,
            destructive: true,
            hidden: !canDeleteConnections,
            onSelect: () => setPendingDelete(row)
          }
        ],
        {
          rowLabel: (row) => `${providerLabel(row.provider)} connection for ${row.username}`
        }
      )
    ],
    [canDeleteConnections, format, providerLabel, t]
  );

  return (
    <div className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
      <div className="min-w-0">
        <DataTable<OAuthConnectionAdmin>
          columns={columns}
          initialPageSize={PAGE_SIZE}
          pageSizeOptions={[10, 20, 50, 100]}
          searchPlaceholder={to("search")}
          filterKey={filters.filterKey}
          inspectorId={openId}
          getRowId={(row) => String(row.id)}
          toolbar={<FilterBar defs={defs} filters={filters} />}
          emptyMessage={to("noMatches")}
          onRowClick={(row) => setParams({ id: String(row.original.id) })}
          renderMobileCard={(row) => (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {row.original.display_name ?? row.original.username}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {providerLabel(row.original.provider)} · {row.original.auth_user_username}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {row.original.token_expires_at
                  ? isTokenExpired(row.original.token_expires_at)
                    ? to("tokenExpired")
                    : to("tokenActive")
                  : t("noToken")}
              </p>
            </div>
          )}
          queryKey={(page, search, pageSize, sortField, sortDir) => [
            "access-admin",
            "oauth-connections",
            page,
            search,
            pageSize,
            sortField,
            sortDir,
            providerFilter
          ]}
          queryFn={(page, search, pageSize, sortField, sortDir) =>
            rbacService.listOAuthConnections({
              page,
              per_page: pageSize,
              sort: sortField ?? undefined,
              order: sortDir,
              search: search || undefined,
              provider: providerFilter || undefined
            })
          }
          onPageRowsChange={setPageRows}
        />
      </div>

      <Inspector
        openId={openRow ? openId : null}
        onClose={() => setParams({ id: null })}
        title={openRow ? (openRow.display_name ?? openRow.username) : ""}
        subtitle={openRow ? providerLabel(openRow.provider) : undefined}
        openHref={openRow ? accountsHref(openRow) : undefined}
        onPrev={
          openIndex > 0 ? () => setParams({ id: String(pageRows[openIndex - 1].id) }) : undefined
        }
        onNext={
          openIndex >= 0 && openIndex < pageRows.length - 1
            ? () => setParams({ id: String(pageRows[openIndex + 1].id) })
            : undefined
        }
      >
        {openRow ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("provider")}>
              <ProviderBadge provider={openRow.provider} />
            </Field>
            <Field label={t("providerId")}>
              <span className="font-mono tabular-nums">{openRow.provider_user_id}</span>
            </Field>
            <Field label={t("providerUsername")}>{openRow.username}</Field>
            <Field label={t("providerEmail")}>{openRow.email ?? to("notShared")}</Field>
            <Field label={t("authorization")}>
              <Link
                href={accountsHref(openRow)}
                className="text-primary hover:underline"
              >
                {openRow.auth_user_username ?? `#${openRow.auth_user_id}`}
              </Link>
            </Field>
            <Field label={t("authEmail")}>{openRow.auth_user_email ?? t("unavailable")}</Field>
            <Field label={t("connected")}>
              <span className="tabular-nums">{openRow.created_at.slice(0, 10)}</span>
            </Field>
            <Field label={t("token")}>
              {openRow.token_expires_at
                ? isTokenExpired(openRow.token_expires_at)
                  ? t("tokenExpiredOn", { date: openRow.token_expires_at.slice(0, 10) })
                  : t("tokenValidUntil", { date: openRow.token_expires_at.slice(0, 10) })
                : t("noStoredToken")}
            </Field>
          </div>
        ) : null}
      </Inspector>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        pending={deleteMutation.isPending}
        intent={{
          title: to("removeTitle"),
          description: pendingDelete
            ? to("removeDescription", { account: pendingDelete.display_name ?? pendingDelete.username, authAccount: pendingDelete.auth_user_username ?? `#${pendingDelete.auth_user_id}`, provider: providerLabel(pendingDelete.provider) })
            : "",
          confirmLabel: t("removeConnection"),
          tone: "danger"
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
