"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeCheck, CheckCircle, ShieldAlert, Trash2, UserRound, XCircle } from "lucide-react";

import { columnMeta, createKebabColumn } from "@/components/data-table";
import { StatusIcon } from "@/components/admin/StatusIcon";
import { Badge } from "@/components/ui/badge";
import { getSingleLinkedPlayer } from "@/lib/auth/profile-links";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import type { AuthAdminUser } from "@/types/rbac.types";

/** The account row: the login, the player behind it, whether it may sign in, and its roles. */
export function useAccountColumns({
  canReadPeople,
  isSuperuser,
  onDelete
}: Readonly<{
  canReadPeople: boolean;
  isSuperuser: boolean;
  /** Stable identity required: the kebab column closes over it. */
  onDelete: (account: AuthAdminUser) => void;
}>): ColumnDef<AuthAdminUser>[] {
  const t = useTranslations("adminAccess.common");
  const currentUserId = useAuthProfileStore((state) => state.user?.id);
  return useMemo<ColumnDef<AuthAdminUser>[]>(
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
        meta: columnMeta<AuthAdminUser>({ align: "center" }),
        cell: ({ row }) =>
          row.original.roles.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t("noRoles")}</span>
          ) : (
            <div className="flex flex-wrap justify-center gap-1">
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
              onSelect: () => onDelete(row)
            }
          ];
        },
        { rowLabel: (row) => row.email }
      )
    ],
    [canReadPeople, currentUserId, isSuperuser, onDelete, t]
  );
}
