"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeCheck, CheckCircle, ShieldAlert, Trash2, UserRound, XCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { DataTable, columnMeta, createKebabColumn } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { AccountInspector } from "@/components/admin/access/AccountInspector";
import { accountEmail, accountTitle } from "@/components/admin/access/AccountCard";
import { FilterBar } from "@/components/kit/FilterBar";
import { Inspector } from "@/components/kit/Inspector";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { useFilters, type FilterDef } from "@/components/kit/useFilters";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/hooks/usePermissions";
import { useQueryParams } from "@/hooks/useQueryParams";
import { getSingleLinkedPlayer } from "@/lib/auth/profile-links";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { rbacService } from "@/services/rbac.service";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import type { AuthAdminUser } from "@/types/rbac.types";
import { accessQueryKeys } from "@/lib/access/query-keys";

const PAGE_SIZE = 15;

/** Under the inspector title: the login name, when the title is the player, and a real email. */
function accountSubtitle(account: AuthAdminUser): string | undefined {
  const parts = [
    accountTitle(account) === account.username ? null : `@${account.username}`,
    accountEmail(account)
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Auth accounts (T2, F15) — who can sign in, and with what.
 *
 * Named "Accounts" rather than "Users" on purpose: two sidebar entries called
 * "Users" (auth logins here, player identities in People) were the collision
 * the new IA removes. This screen owns the login; People owns the person, and
 * the inspector links across.
 */
export default function AccessAdminAccountsPage() {
  const t = useTranslations("adminAccess.common");
  const ta = useTranslations("adminAccess.accounts");
  const queryClient = useQueryClient();
  const { hasPermission, isSuperuser, canAccessPermission } = usePermissions();
  const currentUserId = useAuthProfileStore((state) => state.user?.id);
  // `id` is the inspector, not a filter: opening a row must not drop the page
  // the row is on, so nothing resets here.
  const { searchParams, setParams } = useQueryParams({ resetOnChange: [], shallow: true });
  const openId = searchParams?.get("id") ?? null;

  const canReadRoles = hasPermission("role.read");
  const canAssignRoles = hasPermission("role.update") && canReadRoles;
  const canUpdateAccount = hasPermission("auth_user.update");
  // Same gate as the People route: a workspace-scoped `user.read` opens it.
  const canReadPeople = canAccessPermission("user.read");

  const [pageRows, setPageRows] = useState<AuthAdminUser[]>([]);
  const [pendingDelete, setPendingDelete] = useState<AuthAdminUser | null>(null);

  const rolesQuery = useQuery({
    queryKey: accessQueryKeys.rolesAll(),
    queryFn: () => rbacService.listRolesAll(),
    enabled: canReadRoles
  });
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);

  const defs = useMemo<FilterDef[]>(
    () => [
      {
        key: "role",
        label: t("role"),
        kind: "single",
        options: roles.map((role) => ({ value: String(role.id), label: role.name }))
      },
      {
        key: "exclude_role",
        label: t("excludeRoleLabel"),
        kind: "multi",
        options: roles.map((role) => ({ value: String(role.id), label: role.name }))
      },
      {
        key: "status",
        label: t("status"),
        kind: "single",
        options: [
          { value: "active", label: t("active") },
          { value: "inactive", label: t("inactive") }
        ]
      },
      { key: "superuser", label: t("superusersOnly"), kind: "toggle" }
    ],
    [roles, t]
  );

  const filters = useFilters(defs);
  const roleFilter = String(filters.values.role ?? "");
  const excludeRoleIds = Array.isArray(filters.values.exclude_role)
    ? filters.values.exclude_role.map(Number).filter((id) => Number.isInteger(id))
    : [];
  const statusFilter = String(filters.values.status ?? "");
  const superuserFilter = filters.values.superuser === true;

  const openRow = pageRows.find((row) => String(row.id) === openId) ?? null;
  const openIndex = openRow ? pageRows.indexOf(openRow) : -1;

  const deleteMutation = useMutation({
    mutationFn: (userId: number) => rbacService.deleteUser(userId),
    onSuccess: async () => {
      const removed = pendingDelete;
      await queryClient.invalidateQueries({ queryKey: accessQueryKeys.users() });
      setPendingDelete(null);
      if (removed && String(removed.id) === openId) setParams({ id: null });
      notify.success(ta("accountDeleted"));
    },
    onError: (error) => notify.apiError(error)
  });

  const columns = useMemo<ColumnDef<AuthAdminUser>[]>(
    () => [
      {
        accessorKey: "id",
        header: "ID",
        size: 60,
        cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span>
      },
      {
        accessorKey: "email",
        header: t("account"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{row.original.email}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              @{row.original.username}
            </p>
          </div>
        )
      },
      {
        id: "linkedPlayer",
        header: t("playerIdentity"),
        enableSorting: false,
        cell: ({ row }) => {
          const linked = getSingleLinkedPlayer(row.original.linked_players);
          if (!linked) {
            return <span className="text-sm text-muted-foreground">{t("notLinked")}</span>;
          }
          return <span className="truncate text-sm">{linked.player_name}</span>;
        }
      },
      {
        id: "status",
        header: t("status"),
        enableSorting: false,
        meta: columnMeta<AuthAdminUser>({ align: "center" }),
        cell: ({ row }) => (
          <div className="flex flex-wrap justify-center gap-2">
            {row.original.is_active ? (
              <StatusIcon icon={CheckCircle} label={t("active")} variant="success" />
            ) : (
              <StatusIcon icon={XCircle} label={t("inactive")} variant="muted" />
            )}
            {row.original.is_verified ? (
              <StatusIcon icon={BadgeCheck} label={t("verified")} variant="info" />
            ) : null}
            {row.original.is_superuser ? (
              <StatusIcon icon={ShieldAlert} label={t("superuser")} variant="destructive" />
            ) : null}
          </div>
        )
      },
      {
        id: "roles",
        header: t("roles"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.roles.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t("noRoles")}</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.roles.map((role) => (
                <Badge key={role.id} variant="secondary">
                  {role.name}
                </Badge>
              ))}
            </div>
          )
      },
      createKebabColumn<AuthAdminUser>(
        (row) => {
          const linked = getSingleLinkedPlayer(row.linked_players);
          return [
            {
              label: t("openPeople"),
              icon: UserRound,
              hidden: !canReadPeople || linked === null,
              href: linked ? `/admin/people/${linked.player_id}` : undefined
            },
            {
              label: t("deleteAccount"),
              icon: Trash2,
              destructive: true,
              hidden: !isSuperuser || row.id === currentUserId,
              onSelect: () => setPendingDelete(row)
            }
          ];
        },
        { rowLabel: (row) => row.email }
      )
    ],
    [canReadPeople, currentUserId, isSuperuser, t]
  );

  return (
    <div className={cn("grid items-start gap-4", openRow && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
      <div className="min-w-0">
        <DataTable<AuthAdminUser>
          columns={columns}
          initialPageSize={PAGE_SIZE}
          pageSizeOptions={[10, 20, 50, 100]}
          cellAlign="top"
          searchPlaceholder={t("searchAccounts")}
          filterKey={filters.filterKey}
          inspectorId={openId}
          getRowId={(row) => String(row.id)}
          toolbar={<FilterBar defs={defs} filters={filters} />}
          emptyMessage={ta("noAuthMatches")}
          onRowClick={(row) => setParams({ id: String(row.original.id) })}
          renderMobileCard={(row) => (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.original.email}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                @{row.original.username}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {row.original.is_active ? t("active") : t("inactive")} ·{" "}
                {row.original.roles.length === 0
                  ? t("noRoles")
                  : row.original.roles.map((role) => role.name).join(", ")}
              </p>
            </div>
          )}
          queryKey={(page, search, pageSize, sortField, sortDir) => [
            "access-admin",
            "users",
            page,
            search,
            pageSize,
            sortField,
            sortDir,
            { role: roleFilter, excludeRole: excludeRoleIds, status: statusFilter, superuser: superuserFilter }
          ]}
          queryFn={(page, search, pageSize, sortField, sortDir) =>
            rbacService.listUsers({
              page,
              per_page: pageSize,
              sort: sortField ?? undefined,
              order: sortDir,
              search: search || undefined,
              role_id: roleFilter ? Number(roleFilter) : undefined,
              exclude_role_id: excludeRoleIds.length ? excludeRoleIds : undefined,
              is_active: statusFilter ? statusFilter === "active" : undefined,
              is_superuser: superuserFilter ? true : undefined
            })
          }
          onPageRowsChange={setPageRows}
        />
      </div>

      <Inspector
        openId={openRow ? openId : null}
        onClose={() => setParams({ id: null })}
        title={openRow ? accountTitle(openRow) : ""}
        subtitle={openRow ? accountSubtitle(openRow) : undefined}
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
          <AccountInspector
            key={openRow.id}
            userId={openRow.id}
            canAssignRoles={canAssignRoles}
            canUpdateAccount={canUpdateAccount}
            canReadPeople={canReadPeople}
          />
        ) : null}
      </Inspector>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        pending={deleteMutation.isPending}
        intent={{
          title: ta("deleteTitle"),
          description: ta("deleteDescription", { account: pendingDelete?.email ?? t("account") }),
          confirmLabel: t("deleteAccount"),
          tone: "danger",
          cascade: [
            ta("deleteDetailsRoles"),
            ta("deleteDetailsOauth"),
            ta("deleteDetailsKeys"),
            ta("deleteDetailsSessions")
          ]
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
